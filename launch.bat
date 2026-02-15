@echo off
setlocal enabledelayedexpansion

if defined BROWSER (set "BRAVE=!BROWSER!") else set "BRAVE=C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe"
set "EXTDIR=%~dp0proxy-extension"

rem --- Parse proxy from first argument or PROXY env var ---
set "RAW=%~1"
if "!RAW!"=="" if defined PROXY set "RAW=!PROXY!"
if "!RAW!"=="" (
    echo Usage: launch.bat [protocol://]host:port:user:pass [url]
    exit /b 1
)
set "STARTURL=%~2"

rem --- Extract protocol if present (default: http) ---
set "PROTOCOL=http"
set "BODY=!RAW!"
echo !RAW!| findstr /r "^[a-zA-Z0-9]*://" >nul 2>&1
if not errorlevel 1 (
    for /f "tokens=1 delims=:" %%a in ("!RAW!") do set "PROTOCOL=%%a"
    set "BODY=!RAW:*://=!"
)

rem --- Parse host:port:user:pass ---
for /f "tokens=1,2,3,* delims=:" %%a in ("!BODY!") do (
    set "PHOST=%%a"
    set "PPORT=%%b"
    set "PUSER=%%c"
    set "PPASS=%%d"
)

if not defined PPASS (
    echo Proxy format: [protocol://]host:port:user:pass
    exit /b 1
)

echo Proxy: !PROTOCOL!://!PHOST!:!PPORT! ^(user: !PUSER!^)

rem --- SOCKS5 auth relay via gost ---
set "GOST_RELAY="
if /i "!PROTOCOL!"=="socks5" if defined PUSER (
    set "GOST_EXE=%~dp0gost.exe"
    if not exist "!GOST_EXE!" (
        echo ERROR: SOCKS5 with auth requires gost.exe in %~dp0
        echo Download gost v3 from https://github.com/go-gost/gost/releases
        echo Place gost.exe next to this script and try again.
        exit /b 1
    )
    set "GOST_RELAY=1"
    echo Starting gost relay: localhost:10807 -^> socks5://!PHOST!:!PPORT!
    start /b "" "!GOST_EXE!" -L http://:10807 -F socks5://!PUSER!:!PPASS!@!PHOST!:!PPORT!
    timeout /t 2 /nobreak >nul
)

rem --- Detect proxy timezone via GeoIP ---
set "CURL_PROXY_ARG="
if /i "!PROTOCOL!"=="http" set "CURL_PROXY_ARG=--proxy http://!PUSER!:!PPASS!@!PHOST!:!PPORT!"
if /i "!PROTOCOL!"=="https" set "CURL_PROXY_ARG=--proxy http://!PUSER!:!PPASS!@!PHOST!:!PPORT!"
if /i "!PROTOCOL!"=="socks4" set "CURL_PROXY_ARG=--socks4 !PHOST!:!PPORT!"
if /i "!PROTOCOL!"=="socks5" set "CURL_PROXY_ARG=--socks5-hostname !PHOST!:!PPORT! --proxy-user !PUSER!:!PPASS!"
if defined GOST_RELAY set "CURL_PROXY_ARG=--proxy http://127.0.0.1:10807"

set "DETECTED_TZ="
if defined CURL_PROXY_ARG (
    for /L %%i in (1,1,3) do (
        if "!DETECTED_TZ!"=="" (
            for /f "delims=" %%t in ('curl -s --connect-timeout 5 --max-time 10 !CURL_PROXY_ARG! "http://ip-api.com/line/?fields=timezone" 2^>nul') do (
                echo %%t | findstr /r "[/]" >nul 2>&1 && set "DETECTED_TZ=%%t"
                if "!DETECTED_TZ!"=="" echo   GeoIP returned: %%t
            )
            if "!DETECTED_TZ!"=="" (
                echo Timezone attempt %%i/3 failed, retrying in 2s...
                timeout /t 2 /nobreak >nul
            )
        )
    )
)

if defined DETECTED_TZ (
    set "TZ=!DETECTED_TZ!"
    echo Timezone: !DETECTED_TZ!
) else (
    echo WARNING: Could not detect proxy timezone, using system default
)

rem --- Create temp profile and copy extension locally ---
set "PROFILE=%TEMP%\brave-proxy-%RANDOM%%RANDOM%"
mkdir "!PROFILE!"
xcopy /s /i /q "!EXTDIR!" "!PROFILE!\proxy-extension" >nul
set "LOADEXT=!PROFILE!\proxy-extension"
echo Temp profile: !PROFILE!

rem --- Write extension config into the local copy ---
if defined GOST_RELAY (
    >"!LOADEXT!\config.json" echo {"host":"127.0.0.1","port":"10807","user":"","pass":"","protocol":"http"}
) else (
    >"!LOADEXT!\config.json" echo {"host":"!PHOST!","port":"!PPORT!","user":"!PUSER!","pass":"!PPASS!","protocol":"!PROTOCOL!"}
)
if defined DETECTED_TZ (
    >"!LOADEXT!\tz-config.js" echo self.__PROXY_TZ="!DETECTED_TZ!";
) else (
    >"!LOADEXT!\tz-config.js" echo self.__PROXY_TZ=null;
)

rem --- Launch Brave and wait for it to close ---
start /wait "" "!BRAVE!" --user-data-dir="!PROFILE!" --no-first-run --no-default-browser-check --disable-quic --load-extension="!LOADEXT!" !STARTURL!

rem --- Cleanup ---
echo Brave exited, cleaning up...
if defined GOST_RELAY (
    echo Stopping gost relay...
    taskkill /f /im gost.exe >nul 2>&1
)
rmdir /s /q "!PROFILE!" 2>nul
echo Done.
endlocal
