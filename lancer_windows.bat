@echo off
echo ============================================
echo   GymLocator Pro — Lanceur local
echo ============================================
echo.

:: Verifier Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERREUR : Python n'est pas installe.
    echo Telechargez-le sur https://www.python.org
    pause
    exit /b
)

echo Demarrage du serveur local sur http://localhost:8765
echo Fermez cette fenetre pour arreter le serveur.
echo.

:: Se placer dans le dossier du script (au cas ou il est lance depuis ailleurs)
cd /d "%~dp0"

:: Liberer le port 8765 si un ancien serveur y tourne encore.
:: (Sinon un serveur fantome, lance depuis un autre dossier, repond a la place
::  et renvoie des erreurs 404 "File not found".)
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /C:":8765 " ^| findstr "LISTENING"') do (
    echo Arret d'un ancien serveur sur le port 8765 ^(PID %%P^)...
    taskkill /F /PID %%P >nul 2>&1
)

:: Ouvrir le navigateur apres 2 secondes, en parallele du serveur
start "" /min cmd /c "timeout /t 2 >nul & start http://localhost:8765/gymlocator.html"

:: Lancer le serveur Python en servant EXPLICITEMENT ce dossier (bloquant).
:: Le "." final est indispensable : "%~dp0" se termine par un antislash qui,
:: colle a un guillemet, echapperait le guillemet et casserait le chemin.
python -m http.server 8765 --directory "%~dp0."
pause
