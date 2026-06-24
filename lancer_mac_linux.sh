#!/bin/bash
echo "============================================"
echo "  GymLocator Pro — Lanceur local"
echo "============================================"
echo ""

# Vérifier Python
if ! command -v python3 &> /dev/null; then
    echo "ERREUR : Python 3 n'est pas installé."
    echo "Mac : brew install python3"
    echo "Linux : sudo apt install python3"
    exit 1
fi

echo "Serveur local sur http://localhost:8765"
echo "Ctrl+C pour arrêter."
echo ""

# Ouvrir le navigateur après 1.5s
(sleep 1.5 && (open http://localhost:8765/gymlocator.html 2>/dev/null || xdg-open http://localhost:8765/gymlocator.html 2>/dev/null)) &

# Lancer le serveur
cd "$(dirname "$0")"
python3 -m http.server 8765
