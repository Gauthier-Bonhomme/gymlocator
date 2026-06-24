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

:: Ouvrir le navigateur apres 2 secondes, en parallele du serveur
start "" /min cmd /c "timeout /t 2 >nul & start http://localhost:8765/gymlocator.html"

:: Lancer le serveur Python dans le dossier courant (bloquant)
python -m http.server 8765
pause
