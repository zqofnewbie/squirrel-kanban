@echo off
REM ---------------------------------------------------------------
REM  kanban 本地开发环境一键启动（Windows，双击即可）
REM  开两个窗口：后端 Go(:8090) + 前端 Vite(:5173)
REM  浏览器访问 http://127.0.0.1:5173   账号 admin / admin
REM ---------------------------------------------------------------
cd /d "%~dp0"

set GOTOOLCHAIN=local
REM 后端端口：docker 用 8080，dev 错开到 8090，避免和本地已有服务冲突
if not defined API_PORT set API_PORT=8090
if not defined WEB_PORT set WEB_PORT=5173
if not exist ".dev" mkdir ".dev"
if not exist "server\static" mkdir "server\static"
if not exist "server\static\.gitkeep" type nul > "server\static\.gitkeep"
set KANBAN_API=http://127.0.0.1:%API_PORT%
set KANBAN_ADDR=127.0.0.1:%API_PORT%
set KANBAN_DATA=../.dev
set KANBAN_DEV=1

REM 依赖检查
where go >nul 2>nul
if %errorlevel% neq 0 (
  echo   [x] 找不到 go，请先安装 Go 1.24+ 并加入 PATH
  pause & exit /b 1
)
where npm >nul 2>nul
if %errorlevel% neq 0 (
  echo   [x] 找不到 npm，请先安装 Node 22+ 并加入 PATH
  pause & exit /b 1
)
if not exist "web\node_modules" (
  echo   [!] 首次运行，正在安装前端依赖（约 1 分钟）…
  pushd web
  call npm ci --no-audit --no-fund
  if errorlevel 1 exit /b 1
  popd
)

echo.
echo   kanban dev
echo   ---------------------------------------------
echo   API   http://127.0.0.1:%API_PORT%   数据目录 .dev
echo   WEB   http://127.0.0.1:%WEB_PORT%   ^<- 浏览器打开这个
echo.
echo   go run 首次编译约 20-30 秒，等两个窗口都有输出再刷新页面
echo.

netstat -ano | findstr "LISTENING" | findstr ":%API_PORT% " >nul
if %errorlevel%==0 (
  echo   [错误] %API_PORT% 已被占用，请先换端口。
  echo          改本文件的 set API_PORT=xxxx，前端再配 KANBAN_API=http://127.0.0.1:xxxx
  exit /b 1
)
netstat -ano | findstr "LISTENING" | findstr ":%WEB_PORT% " >nul
if %errorlevel%==0 (
  echo   [错误] %WEB_PORT% 已被占用，请先换端口。
  exit /b 1
)

REM 后端：装了 air 就用 air（保存 .go 自动重启），否则 go run
where air >nul 2>nul
if %errorlevel%==0 (
  echo   [api] 使用 air 热重载
  start "kanban-api" cmd /k "cd /d server && air"
) else (
  echo   [api] 使用 go run（改 Go 代码需手动重启本窗口）
  start "kanban-api" cmd /k "cd /d server && go run . -dev -addr 127.0.0.1:%API_PORT% -data ..\.dev"
)

REM 前端：Vite HMR
start "kanban-web" cmd /k "cd /d web && npm run dev -- --port %WEB_PORT% --strictPort"

REM 轮询两个端口，起来后给个明确信号（不用 curl，避免代理干扰）
powershell -NoProfile -Command "$ports=@(%API_PORT%,%WEB_PORT%); $ok=$false; for($i=0; $i -lt 90; $i++){ $all=$true; foreach($p in $ports){ $c=New-Object Net.Sockets.TcpClient; try{ $c.Connect('127.0.0.1',$p) } catch { $all=$false }; $c.Close() }; if($all){ $ok=$true; break }; Start-Sleep -Milliseconds 800 }; if($ok){ Write-Host ''; Write-Host ('  ✅ 就绪 → http://127.0.0.1:' + %WEB_PORT% + '   (admin / admin)') -ForegroundColor Green; Write-Host '     停服务：直接关掉那两个窗口' } else { Write-Host '  [x] 90 秒内没起来，看两个窗口的报错' -ForegroundColor Red }"

echo.
echo   按任意键关闭本窗口（不会停掉服务）
pause >nul
