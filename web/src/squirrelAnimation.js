// Articulated parts reuse the original PNG; the face and limbs are never stretched.
export function mountSquirrelAnimation(root) {
  const parts = new Map(
    Array.from(root.querySelectorAll('[id]'), (element) => [
      element.getAttribute('data-part') || element.id,
      element,
    ]),
  )
  const $ = (id) => parts.get(id)
  const events = new AbortController()
  const listen = (target, event, handler) =>
    target?.addEventListener(event, handler, { signal: events.signal })
  let disposed = false
  const timing = {
    release: 130,
    impact: 450,
    landed: 1610,
    chaseStart: 1870,
    chaseEnd: 3320,
    pickupStart: 3440,
    grasp: 3940,
    stoodUp: 4280,
    stanceClose: 4290,
    returnStart: 4380,
    returnEnd: 6090,
    tailSettle: 6430,
    end: 6610,
  }
  const duration = timing.end
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
  let playing = false,
    frame = 0,
    startedAt = null,
    assetsReady = false
  const clamp = (v) => Math.max(0, Math.min(1, v))
  const ease = (v) => {
    const t = clamp(v)
    return t * t * (3 - 2 * t)
  }
  const mix = (a, b, t) => a + (b - a) * t
  const base = { x: 138, y: 94, bend: 0, crouch: 0, reach: 0 }
  const destinationX = 650
  const poses = [
    { t: 0, ...base },
    { t: 90, ...base, bend: -2 },
    { t: 300, ...base, bend: 5 },
    { t: timing.landed, ...base, bend: 3 },
    // Watch the nut settle, then shift weight before the first step.
    { t: timing.chaseStart - 70, ...base, bend: 3 },
    { t: timing.chaseStart, ...base, bend: 8 },
    { t: timing.chaseEnd, ...base, x: destinationX, bend: 6 },
    // A short arrival beat separates braking from bending down to reach.
    { t: timing.pickupStart, ...base, x: destinationX, bend: 2 },
    { t: timing.pickupStart + 160, ...base, x: destinationX, bend: 2, crouch: 4, reach: 34 },
    { t: timing.grasp - 80, ...base, x: destinationX, bend: -4, crouch: 11, reach: 73 },
    { t: timing.grasp + 20, ...base, x: destinationX, bend: -4, crouch: 11, reach: 73 },
    // Lift the nut first, then shift the body's weight upward with planted feet.
    { t: timing.grasp + 90, ...base, x: destinationX, bend: -4, crouch: 11, reach: 55 },
    { t: timing.grasp + 230, ...base, x: destinationX, bend: -2.5, crouch: 4.8, reach: 18 },
    { t: timing.stoodUp, ...base, x: destinationX, bend: -2 },
    { t: timing.returnStart, ...base, x: destinationX, bend: -5 },
    { t: timing.returnEnd, ...base, bend: -3 },
    { t: timing.returnEnd + 180, ...base, bend: 1.5 },
    { t: timing.returnEnd + 360, ...base, bend: -0.5 },
    { t: duration, ...base },
  ]
  function poseAt(t) {
    if (t <= 0) return { ...poses[0] }
    for (let i = 1; i < poses.length; i++)
      if (t <= poses[i].t) {
        const a = poses[i - 1],
          b = poses[i],
          dt = b.t - a.t,
          u = clamp((t - a.t) / dt)
        // Monotone cubic interpolation carries velocity through intermediate poses,
        // and comes to rest only when a hold or a change of direction requires it.
        const tangent = (index, key) => {
          if (index === 0 || index === poses.length - 1) return 0
          const prev = poses[index - 1],
            cur = poses[index],
            next = poses[index + 1]
          const left = (cur[key] - prev[key]) / (cur.t - prev.t)
          const right = (next[key] - cur[key]) / (next.t - cur.t)
          return left * right > 0 ? (2 * left * right) / (left + right) : 0
        }
        const h00 = 2 * u * u * u - 3 * u * u + 1,
          h10 = u * u * u - 2 * u * u + u
        const h01 = -2 * u * u * u + 3 * u * u,
          h11 = u * u * u - u * u
        return Object.fromEntries(
          ['x', 'y', 'bend', 'crouch', 'reach'].map((k) => [
            k,
            h00 * a[k] + h10 * dt * tangent(i - 1, k) + h01 * b[k] + h11 * dt * tangent(i, k),
          ]),
        )
      }
    return { ...base }
  }
  function handPoint(p) {
    // The original left arm and pinecone turn together around the shoulder.
    // Both transforms are rigid: reaching changes angle, never limb length.
    const arm = (p.reach * Math.PI) / 180
    const x = 139 + (192 - 139) * Math.cos(arm) - (160 - 163) * Math.sin(arm)
    const y = 163 + (192 - 139) * Math.sin(arm) + (160 - 163) * Math.cos(arm)
    const a = (p.bend * Math.PI) / 180,
      dx = x - 145,
      dy = y - 220
    return {
      x: p.x + 145 + dx * Math.cos(a) - dy * Math.sin(a),
      y: p.y + p.crouch + 220 + dx * Math.sin(a) + dy * Math.cos(a),
      r: p.bend + p.reach,
    }
  }
  const pickup = handPoint(poseAt(timing.grasp))
  // Sample the shared artwork's actual outline instead of a coarse polygon.
  const nutPath = $('nutShape'),
    nutPerimeter = nutPath.getTotalLength()
  const nutOutline = Array.from({ length: 241 }, (_, i) => {
    const p = nutPath.getPointAtLength((nutPerimeter * i) / 240)
    return { x: p.x - 192, y: p.y - 160 }
  })
  const restAngle = 789
  const impactAngle = 90
  function contactHeight(r) {
    const a = (r * Math.PI) / 180
    return Math.max(...nutOutline.map((p) => p.x * Math.sin(a) + p.y * Math.cos(a))) + 1
  }
  // Subpixel calibration keeps the resting contact and handoff exactly aligned.
  const contactFloor = pickup.y + contactHeight(restAngle)
  function groundY(r) {
    return contactFloor - contactHeight(r)
  }
  const dropFrom = handPoint(poseAt(timing.release))
  const fallDuration = timing.impact - timing.release
  const rollDuration = timing.landed - timing.impact
  // Preserve forward velocity at impact, then lose speed steadily to friction.
  const forwardVelocity = (pickup.x - dropFrom.x) / (fallDuration + rollDuration / 2)
  const impactX = dropFrom.x + forwardVelocity * fallDuration
  const rollDistance = pickup.x - impactX
  function flightAt(t) {
    if (t < timing.impact) {
      const u = clamp((t - timing.release) / fallDuration)
      return {
        x: dropFrom.x + forwardVelocity * u * fallDuration,
        y: mix(dropFrom.y, groundY(impactAngle), u * u),
        r: mix(dropFrom.r, impactAngle, u),
      }
    }
    if (t < timing.landed) {
      const elapsed = t - timing.impact,
        u = clamp(elapsed / rollDuration)
      const distance = 1 - (1 - u) ** 2
      const r = mix(impactAngle, restAngle, distance)
      // Two small ballistic rebounds; the irregular shell then rolls in contact.
      let bounce = 0
      if (elapsed < 150) {
        const b = elapsed / 150
        bounce = 4 * 7 * b * (1 - b)
      } else if (elapsed < 245) {
        const b = (elapsed - 150) / 95
        bounce = 4 * 1.6 * b * (1 - b)
      }
      return { x: impactX + rollDistance * distance, y: groundY(r) - bounce, r }
    }
    return { ...pickup, r: restAngle }
  }
  // Feet keep the original proximal pivots and a bounded ankle stroke.
  // Distance-driven phases synchronize contact, recovery and torso motion.
  const legJoints = { back: { x: 138, y: 233 }, front: { x: 200, y: 232 } }
  function walkingFootAt(p, bob, cycles, stride, direction, offset, envelope, side) {
    const joint = legJoints[side]
    const phase = (cycles + offset) % 1
    // A short planted interval cancels world travel. The return stroke lifts
    // the toes and recovers smoothly, with matching velocity at either end.
    const contact = 0.18,
      half = (stride * contact) / 2
    let travel = half - stride * phase,
      lift = 0
    if (phase > contact) {
      const u = (phase - contact) / (1 - contact),
        u2 = u * u,
        u3 = u2 * u
      const tangent = -stride * (1 - contact)
      travel =
        (2 * u3 - 3 * u2 + 1) * -half +
        (u3 - 2 * u2 + u) * tangent +
        (-2 * u3 + 3 * u2) * half +
        (u3 - u2) * tangent
      lift = 4 * Math.sin(Math.PI * u) ** 2
    }
    const a = (p.bend * Math.PI) / 180
    const x = 145 + (joint.x - 145) * Math.cos(a) - (joint.y - 220) * Math.sin(a)
    const y = 220 + (joint.x - 145) * Math.sin(a) + (joint.y - 220) * Math.cos(a) + p.crouch + bob
    // Keep the short foot stroke inside the original ankle overlap.
    return {
      x: (x - joint.x + direction * travel) * envelope,
      y: (((y - joint.y) * lift) / 4 - lift) * envelope,
      r: ((p.bend * lift) / 4 - 2 * lift) * envelope,
      pivotX: joint.x,
      pivotY: joint.y,
    }
  }
  function render(t) {
    const p = poseAt(t)
    $('stage').setAttribute('viewBox', `${base.x} ${base.y} 256 256`)
    const outbound = t > timing.chaseStart && t < timing.chaseEnd
    const returning = t > timing.returnStart && t < timing.returnEnd
    const moving = outbound || returning
    const distance = destinationX - base.x
    const travelled = moving ? Math.abs(p.x - (outbound ? base.x : destinationX)) : 0
    const stride = distance / Math.ceil(distance / 72)
    const cycles = travelled / stride
    const envelope = moving ? ease(travelled / 18) * ease((distance - travelled) / 18) : 0
    const phase = cycles * Math.PI * 2
    const bob = -3 * (0.5 - 0.5 * Math.cos(phase * 2)) * envelope
    const direction = outbound ? 1 : -1
    const footA = moving
      ? walkingFootAt(p, bob, cycles, stride, direction, 0, envelope, 'back')
      : { x: 0, y: 0, r: 0, pivotX: 138, pivotY: 233 }
    const footB = moving
      ? walkingFootAt(p, bob, cycles, stride, direction, 0.5, envelope, 'front')
      : { x: 0, y: 0, r: 0, pivotX: 200, pivotY: 232 }
    $('squirrel').setAttribute('transform', `translate(${p.x} ${p.y})`)
    $('torso').setAttribute('transform', `translate(0 ${p.crouch + bob}) rotate(${p.bend} 145 220)`)
    // Full-height original torso: crouching is translation and joint rotation.
    $('bodyArt').setAttribute('transform', 'translate(0 0)')
    // Keep both contacts fixed through the entire pickup and stand-up.
    const stance = ease((t - timing.chaseEnd) / 230) * (1 - ease((t - timing.stanceClose) / 90))
    footA.x -= 2 * stance
    footB.x += 3 * stance
    $('backFoot').setAttribute(
      'transform',
      `translate(${footA.x} ${footA.y}) rotate(${footA.r} ${footA.pivotX} ${footA.pivotY})`,
    )
    $('frontLeg').setAttribute(
      'transform',
      `translate(${footB.x} ${footB.y}) rotate(${footB.r} ${footB.pivotX} ${footB.pivotY})`,
    )
    // The tail root follows the exact current hip transform. Only the distal
    // swing lags, so inertia never pulls the attachment away from the body.
    const angle = (p.bend * Math.PI) / 180
    const rootX = 145 + (111 - 145) * Math.cos(angle) - (207 - 220) * Math.sin(angle)
    const rootY = 220 + (111 - 145) * Math.sin(angle) + (207 - 220) * Math.cos(angle)
    const lag = poseAt(t - 90)
    const tailSettle = 1 - ease((t - timing.tailSettle) / (duration - timing.tailSettle))
    const tailAngle =
      (-lag.bend * 0.12 - (lag.crouch / 11) * 2.5 + Math.sin(phase - 0.9) * 3.5 * envelope) *
      tailSettle
    $('tail').setAttribute(
      'transform',
      `translate(${rootX - 111} ${rootY - 207 + p.crouch + bob}) rotate(${tailAngle} 111 207)`,
    )
    const separated = t >= timing.release && t < timing.grasp
    $('heldNut').setAttribute('visibility', separated ? 'hidden' : 'visible')
    $('heldNut').setAttribute('transform', `rotate(${p.reach} 139 163)`)
    const open = separated
      ? ease((t - timing.release) / 110) * (1 - ease((t - (timing.grasp - 210)) / 210))
      : 0
    const swing = Math.sin(phase) * 3 * envelope
    $('leftHand').setAttribute('transform', `rotate(${p.reach - 7 * open + swing} 139 163)`)
    const support =
      -4 * ease((t - (timing.grasp + 140)) / 110) * (1 - ease((t - (timing.grasp + 280)) / 110))
    $('rightHand').setAttribute('transform', `rotate(${8 * open - swing + support} 225 161)`)
    $('looseNut').setAttribute('visibility', separated ? 'visible' : 'hidden')
    if (separated) {
      const n = flightAt(t)
      // Both nut instances share the same occlusion order. Cancel the torso pose
      // for the free nut so its world-space trajectory remains independent.
      const dx = n.x - p.x - 145,
        dy = n.y - p.y - p.crouch - bob - 220
      const localX = 145 + dx * Math.cos(angle) + dy * Math.sin(angle)
      const localY = 220 - dx * Math.sin(angle) + dy * Math.cos(angle)
      $('looseNut').setAttribute(
        'transform',
        `translate(${localX} ${localY}) rotate(${n.r - p.bend})`,
      )
      const height = Math.max(0, groundY(n.r) - n.y)
      $('nutShadow').setAttribute('cx', n.x)
      $('nutShadow').setAttribute('rx', 25 - Math.min(10, height * 0.1))
      $('nutShadow').setAttribute('opacity', 0.7 / (1 + height / 30))
    } else $('nutShadow').setAttribute('opacity', '0')
    // One persistent rig and one shared nut artwork in every state.
    // No complete-image swap or opacity crossfade at either end of playback.
    $('squirrelShadow').setAttribute('cx', p.x + 133)
    $('squirrelShadow').setAttribute('rx', 116 + Math.max(0, p.bend) * 0.3)
    $('squirrelShadow').setAttribute('opacity', 0.9)
    root.dataset.phase =
      t < timing.impact
        ? 'drop'
        : t < timing.landed
          ? 'roll'
          : t < timing.chaseStart
            ? 'react'
            : t < timing.chaseEnd
              ? 'chase'
              : t < timing.pickupStart
                ? 'arrive'
                : t < timing.returnStart
                  ? 'pickup'
                  : t < timing.returnEnd
                    ? 'return'
                    : 'settle'
  }
  function reset() {
    cancelAnimationFrame(frame)
    playing = false
    startedAt = null
    render(0)
    root.dataset.playing = 'false'
    root.dataset.phase = 'idle'
  }
  function tick(now) {
    if (startedAt === null) startedAt = now
    const t = now - startedAt
    if (t >= duration) return reset()
    render(t)
    frame = requestAnimationFrame(tick)
  }
  function play() {
    if (playing || !assetsReady || disposed || reducedMotion.matches) return
    playing = true
    startedAt = null
    root.dataset.playing = 'true'
    frame = requestAnimationFrame(tick)
  }
  listen(document, 'visibilitychange', () => {
    if (document.hidden && assetsReady) reset()
  })
  listen(reducedMotion, 'change', () => {
    if (reducedMotion.matches && assetsReady) reset()
  })
  const ready = Promise.all(
    ['/squirrel-hover/squirrel.png', '/squirrel-hover/chest-repair-v1.png'].map((src) => {
      const img = new Image()
      img.src = src
      return img.decode()
    }),
  ).then(() => {
    if (disposed) return
    assetsReady = true
    reset()
  })
  return {
    play,
    reset,
    ready,
    destroy() {
      disposed = true
      events.abort()
      cancelAnimationFrame(frame)
    },
  }
}
