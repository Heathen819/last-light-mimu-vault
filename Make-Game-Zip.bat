@echo off
REM ===================================================================
REM  Last Light: Mimu Vault - build a file you can send (WINDOWS)
REM
REM  HOW TO USE:
REM    1. Put this file inside your game folder (the one with game.js)
REM    2. Double-click it
REM    3. A zip lands on your Desktop
REM ===================================================================
setlocal EnableDelayedExpansion

set "ROOT=%~dp0"
set "DEST=%ROOT%Mimu Vault Deploy"

echo.
echo ==============================================
echo   Last Light: Mimu Vault - build a send file
echo ==============================================
echo.

if not exist "%ROOT%game.js" (
  echo  X  PROBLEM: I can't find game.js next to this file.
  echo.
  echo     This .bat has to sit INSIDE your game folder -
  echo     the same folder that contains game.js and index.html.
  echo.
  echo     Move it there, then double-click it again.
  echo.
  pause
  exit /b 1
)

echo  Step 1 of 2: collecting the game files...
if exist "%DEST%" rmdir /S /Q "%DEST%"
for %%D in (
  "assets\player" "assets\enemies" "assets\objects\lanterns"
  "assets\environment\cave-walls" "assets\ui" "assets\avatars"
  "assets\fonts" "assets\audio" "assets\audio\music" "assets\audio\sfx"
  "assets\characters\villains" "netlify\functions" "netlify\lib"
) do mkdir "%DEST%\%%~D" 2>nul

REM --- pages and code ---
for %%F in (
  index.html leaderboard.html lore.html sign-in.html profile.html style.css
  game.js world3d.js player3d.js enemysprite.js site-nav.js ui-sfx.js
  auth.js music-player.js proximity-map.js package.json
) do copy /Y "%ROOT%%%F" "%DEST%\" >nul

REM --- 3D models ---
copy /Y "%ROOT%assets\player\banker_torch_animated_18.glb"            "%DEST%\assets\player\" >nul
copy /Y "%ROOT%assets\enemies\null-black-gray-green-eyes3.glb"        "%DEST%\assets\enemies\" >nul
copy /Y "%ROOT%assets\enemies\null-black-purple.glb"                  "%DEST%\assets\enemies\" >nul
copy /Y "%ROOT%assets\objects\lanterns\rock-crystal-lantern.glb"      "%DEST%\assets\objects\lanterns\" >nul
copy /Y "%ROOT%torch_flame_animation_2.0.glb"                         "%DEST%\" >nul

REM --- environment ---
copy /Y "%ROOT%assets\environment\crystal-cave-ref.jpg"    "%DEST%\assets\environment\" >nul
copy /Y "%ROOT%assets\environment\cave-floor.png"          "%DEST%\assets\environment\" >nul
copy /Y "%ROOT%assets\environment\cave-walls\*.png"        "%DEST%\assets\environment\cave-walls\" >nul

REM --- UI, avatars, fonts ---
for %%F in (
  menu-glyph.png last-light-logo.png menu-logo-loop.mp4
  menu-corner-loop.mp4 enter-vault-btn.png vault-menu-bg.png
) do copy /Y "%ROOT%assets\ui\%%F" "%DEST%\assets\ui\" >nul
copy /Y "%ROOT%assets\avatars\*.png"                       "%DEST%\assets\avatars\" >nul
copy /Y "%ROOT%assets\fonts\BreatheFireIii-PKLOB.ttf"      "%DEST%\assets\fonts\" >nul
copy /Y "%ROOT%assets\fonts\AlienAlphabet-nRRqJ.otf"       "%DEST%\assets\fonts\" >nul
copy /Y "%ROOT%assets\player\mimu-fp.png"                  "%DEST%\assets\player\" >nul 2>nul
copy /Y "%ROOT%assets\characters\villains\*.png"           "%DEST%\assets\characters\villains\" >nul 2>nul

REM --- audio ---
copy /Y "%ROOT%assets\audio\theme.mp3"              "%DEST%\assets\audio\" >nul
copy /Y "%ROOT%assets\audio\deus-avarus-menu.mp3"   "%DEST%\assets\audio\" >nul
copy /Y "%ROOT%assets\audio\music\*.mp3"            "%DEST%\assets\audio\music\" >nul 2>nul
copy /Y "%ROOT%assets\audio\music\*.wav"            "%DEST%\assets\audio\music\" >nul 2>nul
copy /Y "%ROOT%assets\audio\sfx\mixkit-creepy-cavern-ambience-loop-2492.wav" "%DEST%\assets\audio\sfx\" >nul

REM --- leaderboard backend ---
copy /Y "%ROOT%netlify\functions\*.mjs" "%DEST%\netlify\functions\" >nul
copy /Y "%ROOT%netlify\lib\*.mjs"       "%DEST%\netlify\lib\" >nul

REM --- netlify config for the packed folder ---
> "%DEST%\netlify.toml" (
  echo [build]
  echo   publish = "."
  echo   functions = "netlify/functions"
  echo.
  echo [build.environment]
  echo   NODE_VERSION = "20"
  echo.
  echo [functions]
  echo   node_bundler = "esbuild"
  echo   included_files = ["./netlify/lib/**"]
  echo.
  echo [[headers]]
  echo   for = "/*.glb"
  echo   [headers.values]
  echo   Content-Type = "model/gltf-binary"
)

echo  Step 2 of 2: zipping it up ^(this takes a minute^)...
set "ZIP=%USERPROFILE%\Desktop\Last-Light-Mimu-Vault.zip"
if exist "%ZIP%" del /F /Q "%ZIP%"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('%DEST%', '%ZIP%')"

if not exist "%ZIP%" (
  echo.
  echo  X  The zip step failed. The folder is still ready here:
  echo     %DEST%
  echo     You can right-click it and choose Send to ^> Compressed folder.
  echo.
  pause
  exit /b 1
)

for %%A in ("%ZIP%") do set /a MB=%%~zA/1048576

echo.
echo ==============================================
echo   Done.
echo.
echo    File:  Last-Light-Mimu-Vault.zip
echo    Where: your Desktop
echo    Size:  !MB! MB
echo.
echo   Too big to email - send it with WeTransfer,
echo   Google Drive, or Dropbox. Or copy it to
echo   your USB drive.
echo ==============================================
echo.

explorer /select,"%ZIP%"
pause
