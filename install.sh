#!/bin/bash

# Firestore Export Tool - Quick Install Script
# Usage: curl -sL https://raw.githubusercontent.com/TheophilusChinomona/Export-from-firestore/main/install.sh | bash

set -e

REPO_URL="https://github.com/TheophilusChinomona/Export-from-firestore.git"
INSTALL_DIR="firestore-export"

echo ""
echo "🔥 Firestore Export Tool - Installer"
echo "====================================="
echo ""

# Check for required tools
check_command() {
    if ! command -v $1 &> /dev/null; then
        echo "❌ Error: $1 is required but not installed."
        exit 1
    fi
}

check_command git
check_command node
check_command npm

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Error: Node.js 18+ is required. You have $(node -v)"
    exit 1
fi

echo "✓ Prerequisites checked (git, node $(node -v), npm)"
echo ""

# Clone the repository
if [ -d "$INSTALL_DIR" ]; then
    echo "📁 Directory '$INSTALL_DIR' already exists."
    read -p "   Overwrite? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -rf "$INSTALL_DIR"
    else
        echo "   Installation cancelled."
        exit 0
    fi
fi

echo "📥 Cloning repository..."
git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
cd "$INSTALL_DIR"

echo ""
echo "📦 Installing dependencies..."
npm install --silent

echo ""
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "✅ Installation complete!"
echo ""
echo "📋 Next steps:"
echo ""
echo "   1. Get your Firebase service account key:"
echo "      • Go to https://console.firebase.google.com"
echo "      • Select your project → ⚙️ Settings → Service accounts"
echo "      • Click 'Generate new private key'"
echo ""
echo "   2. Add the key to this directory:"
echo "      cp /path/to/downloaded-key.json $INSTALL_DIR/serviceAccountKey.json"
echo ""
echo "   3. Run the export:"
echo "      cd $INSTALL_DIR"
echo "      npm run export                    # Export all (JSON + SQL)"
echo "      npm run export -- --format json   # JSON only"
echo "      npm run export -- --format sql    # SQL only"
echo ""
echo "📖 For full documentation, see: README.md"
echo ""
