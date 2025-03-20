#!/bin/bash

echo "Setting up Solana development environment..."

# Check if Solana CLI is installed
if ! command -v solana &> /dev/null; then
    echo "Solana CLI not found. Installing..."
    sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
    export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
    echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> ~/.bashrc
else
    echo "Solana CLI already installed."
fi

# Create .config/solana directory if it doesn't exist
mkdir -p ~/.config/solana

# Check if test-authority wallet exists
if [ ! -f ~/.config/solana/test-authority.json ]; then
    echo "Creating test-authority wallet..."
    solana-keygen new --no-bip39-passphrase -o ~/.config/solana/test-authority.json
    echo "Wallet created at ~/.config/solana/test-authority.json"
else
    echo "Test-authority wallet already exists."
fi

# Configure Solana CLI to use localnet
solana config set --url localhost

# Start local validator if not already running
if ! pgrep -x "solana-test-val" > /dev/null; then
    echo "Starting Solana test validator in the background..."
    solana-test-validator > /dev/null 2>&1 &
    echo "Waiting for validator to start..."
    sleep 5
else
    echo "Solana test validator is already running."
fi

# Airdrop SOL to the test wallet
echo "Airdropping 5 SOL to test wallet..."
solana airdrop 5 $(solana address -k ~/.config/solana/test-authority.json)

echo "Setup complete! You can now run your Solana programs and tests."
echo "To check your balance: solana balance -k ~/.config/solana/test-authority.json" 