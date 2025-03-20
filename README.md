# Battle Memecoin

A Solana program for managing meme coin betting battles.

## Prerequisites

- Node.js and npm or yarn
- Rust and Cargo
- Solana CLI tools

## Setup

To set up the development environment, run:

```bash
# Install dependencies
npm install

# Set up Solana CLI, create wallet, and start local validator
npm run setup
```

The setup script will:
1. Install Solana CLI tools if not already installed
2. Create a test wallet at `~/.config/solana/test-authority.json` if it doesn't exist
3. Configure Solana CLI to use localhost
4. Start a local Solana validator if not already running
5. Airdrop SOL to the test wallet

## Development

```bash
# View all available commands and workflow
npm run help

# Build the program
npm run build

# Deploy the program to the local network
npm run deploy

# Initialize the program
npm run initialize
```

## Workflow

Full workflow for using the application:

1. **Initialize the program**
   ```bash
   npm run initialize
   ```

2. **Create a match**
   ```bash
   # Create match with default values (MATCH_001, DOGE vs SHIB)
   npm run create-match

   # Create match with custom values
   npm run create-match -- --matchid MATCH_002 --fighter1 BTC --fighter2 ETH
   ```
   Note the generated match public key from the output.

3. **Place a bet**
   ```bash
   # Place a 0.1 SOL bet on DOGE
   npm run place-bet -- --matchaccount <MATCH_ACCOUNT_PUBLIC_KEY> --fighter DOGE --amount 0.1
   ```

4. **Update match status**
   ```bash
   # Set match status to Battle (required before ending match)
   npm run update-status -- --matchaccount <MATCH_ACCOUNT_PUBLIC_KEY>
   ```

5. **End the match**
   ```bash
   # End the match with DOGE as winner
   npm run end-match -- --matchaccount <MATCH_ACCOUNT_PUBLIC_KEY> --winner DOGE
   ```

6. **Claim prizes** (after match is ended)
   ```bash
   # Distribute prizes to all winners
   npm run claim-prize -- --matchaccount <MATCH_ACCOUNT_PUBLIC_KEY> --matchid MATCH_001
   
   # Or distribute to specific winners only
   npm run claim-prize -- --matchaccount <MATCH_ACCOUNT_PUBLIC_KEY> --winners <PUBLIC_KEY_1>,<PUBLIC_KEY_2>
   ```

7. **Claim refunds** (if match was cancelled/refunded)
   ```bash
   # Process refunds for all bettors
   npm run claim-refund -- --matchaccount <MATCH_ACCOUNT_PUBLIC_KEY>
   
   # Or process refunds for specific bettors
   npm run claim-refund -- --matchaccount <MATCH_ACCOUNT_PUBLIC_KEY> --bettors <PUBLIC_KEY_1>,<PUBLIC_KEY_2>
   ```

8. **Control program state**
   ```bash
   # Pause the program (prevents new bets/matches)
   npm run set-pause-state -- --paused true
   
   # Unpause the program
   npm run set-pause-state -- --paused false
   ```

All scripts support the `--help` flag to show available options:
```bash
npm run create-match -- --help
npm run place-bet -- --help
npm run update-status -- --help
npm run end-match -- --help
npm run claim-prize -- --help
npm run claim-refund -- --help
npm run set-pause-state -- --help
```

All scripts automatically use the wallet at `$HOME/.config/solana/test-authority.json` rather than relying on environment variables to resolve the path.

## Running Tests

Tests can be run with:

```bash
npm run test
```

## File Structure

- `/programs` - Solana Rust program code
- `/app` - Frontend application code
- `/tests` - Integration tests
- `/scripts` - Utility scripts for development and deployment

## Environment Variables

The scripts use the following environment variables, but will fall back to defaults if not provided:

```
ANCHOR_PROVIDER_URL=http://localhost:8899
```

## Troubleshooting

If you encounter wallet-related errors, try:

1. Run `npm run setup` to create and configure a test wallet
2. Ensure your wallet file exists at `$HOME/.config/solana/test-authority.json`
3. Check that your local Solana validator is running

## License

ISC 