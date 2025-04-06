#!/usr/bin/env node

console.log(`
┌─────────────────────────────────────┐
│       Battle Memecoin Scripts       │
└─────────────────────────────────────┘

Steps to use this program:

1. Setup & Deploy:
   $ npm run setup      - Setup Solana environment and test wallet
   $ npm run build      - Build program Solana
   $ npm run deploy     - Deploy program to local Solana network
   $ npm run initialize - Initialize program (setup house wallet)

2. Create Match:
   # Create match with default values (MATCH_001, DOGE vs SHIB)
   $ npm run create-match

   # Create match with custom values
   $ npm run create-match -- --matchid MATCH_002 --fighter1 BTC --fighter2 ETH

   # Show help for create-match options
   $ npm run create-match -- --help

3. Place Bet:
   # Example: Place a 0.1 SOL bet on DOGE in match MATCH_001
   $ npm run place-bet -- --matchaccount <MATCH_ACCOUNT_PUBLIC_KEY> --fighter DOGE --amount 0.1

   # Show help for place-bet options
   $ npm run place-bet -- --help

4. Update Match Status:
   # Update match status to Battle
   $ npm run update-status -- --matchaccount <MATCH_ACCOUNT_PUBLIC_KEY>

   # Update to a different status
   $ npm run update-status -- --matchaccount <MATCH_ACCOUNT_PUBLIC_KEY> --status Completed

   # Show help for update-status options
   $ npm run update-status -- --help

5. End Match:
   # End match with DOGE as winner
   $ npm run end-match -- --matchaccount <MATCH_ACCOUNT_PUBLIC_KEY> --winner DOGE

   # Show help for end-match options
   $ npm run end-match -- --help

6. Claim Prize:
   # Distribute prizes to all winners of a match
   $ npm run claim-prize -- --matchaccount <MATCH_ACCOUNT_PUBLIC_KEY> --matchid MATCH_001

   # Distribute prizes to specific winners only (comma-separated list)
   $ npm run claim-prize -- --matchaccount <MATCH_ACCOUNT_PUBLIC_KEY> --winners <PUBLIC_KEY_1>,<PUBLIC_KEY_2>

   # Show help for claim-prize options
   $ npm run claim-prize -- --help

7. Claim Refund:
   # Process refunds for all bettors of a match
   $ npm run claim-refund -- --matchaccount <MATCH_ACCOUNT_PUBLIC_KEY> --matchid MATCH_001

   # Process refunds for specific bettors only (comma-separated list)
   $ npm run claim-refund -- --matchaccount <MATCH_ACCOUNT_PUBLIC_KEY> --bettors <PUBLIC_KEY_1>,<PUBLIC_KEY_2>

   # Show help for claim-refund options
   $ npm run claim-refund -- --help

8. Set Pause State:
   # Pause the program
   $ npm run set-pause-state -- --paused true

   # Unpause the program
   $ npm run set-pause-state -- --paused false

   # Show help for set-pause-state options
   $ npm run set-pause-state -- --hel

9. Emergency Operations:
   # Perform emergency refund for a match
   $ npm run emergency-refund -- --matchaccount <MATCH_ACCOUNT_PUBLIC_KEY> --matchid MATCH_001

   # Show help for emergency operations
   $ npm run emergency-refund -- --help

10. House Wallet Transfer CPI:
   # Transfer SOL from house wallet to recipient
   $ npm run house-wallet-transfer-cpi -- --recipient <RECIPIENT_PUBLIC_KEY> --amount <AMOUNT> --programid <PROGRAM_ID> --url <RPC_URL> --keypair <PATH_TO_AUTHORITY_KEYPAIR>

11. Reclaim Prize:
   # Reclaim prize for a bettor
   $ npm run reclaim-prize -- --matchaccount <MATCH_ACCOUNT_PUBLIC_KEY> --matchid MATCH_001 --bettor <BETTOR_PUBLIC_KEY> --keypair <PATH_TO_AUTHORITY_KEYPAIR>

   # Show help for reclaim-prize options
   $ npm run reclaim-prize -- --help

   # Show help for house wallet transfer options
   $ npm run house-wallet-transfer-cpi -- --help

Command Examples After Creating a Match:
When you run create-match, it will output commands that you can copy and paste
to run the subsequent steps with the correct parameters.

Available Options:

create-match:
  --matchid, -m    Match ID                  [string] [default: "MATCH_001"]
  --fighter1, -f1  First fighter name        [string] [default: "DOGE"]
  --fighter2, -f2  Second fighter name       [string] [default: "SHIB"]

place-bet:
  --matchaccount, -a  Match account public key    [string] [required]
  --matchid, -m       Match ID                    [string] [default: "MATCH_001"]
  --fighter, -f       Fighter to bet on           [string] [default: "DOGE"]
  --amount, -amt      Bet amount in SOL           [number] [default: 0.1]
  --keypair, -k       Path to keypair file (bettor) [string]

update-status:
  --matchaccount, -a  Match account public key    [string] [required]
  --status, -s        New match status            [string] [choices: "Initialized", "Battle", "Completed"] [default: "Battle"]

end-match:
  --matchaccount, -a  Match account public key    [string] [required]
  --matchid, -m       Match ID                    [string] [default: "MATCH_001"]
  --winner, -w        Winner fighter name         [string] [default: "DOGE"]

claim-prize:
  --matchaccount, -a  Match account public key    [string] [required]
  --matchid, -m       Match ID                    [string] [default: "MATCH_001"]
  --winners, -w       Comma-separated list of winner public keys [string] [default: ""]

claim-refund:
  --matchaccount, -a  Match account public key    [string] [required]
  --matchid, -m       Match ID                    [string] [default: "MATCH_001"]
  --bettors, -b       Comma-separated list of bettor public keys [string] [default: ""]

set-pause-state:
  --paused, -p        Set program to paused state  [boolean] [default: true]

initialize:
  --keypair, -k       Path to keypair file         [string]

emergency-refund:
  --matchaccount, -a  Match account public key    [string] [required]
  --matchid, -m       Match ID                    [string] [required]
  --keypair, -k       Path to keypair file (authority) [string]

reclaim-prize:
  --matchaccount, -a  Match account public key    [string] [required]
  --matchid, -m       Match ID                    [string] [required]
  --bettor, -b        Public key of the bettor to reclaim prize for [string] [required]
  --keypair, -k       Path to keypair file (authority) [string]

house-wallet-transfer-cpi:
  --recipient, -r     Recipient public key         [string] [required]
  --amount, -amt      Amount to transfer           [number] [required]
  --programid, -p     Program ID                  [string] [default: "3dBYh1pjekocsJQGXM3y1MW6bjVrvvnCXpVEZTffGvmC"]
  --url, -u           RPC URL                     [string] [default: "https://api.devnet.solana.com"]
  --keypair, -k       Path to keypair file (authority) [string]

get-match:
  --matchaccount, -a  Match account public key    [string] [required]
  --keypair, -k       Path to keypair file (authority) [string]

Notes:
- Ensure wallet has enough SOL (via 'npm run setup')
- Program runs on local Solana network
- All scripts automatically use wallet at ${require('os').homedir()}/.config/solana/test-authority.json
- If you encounter wallet-related errors, try:
  1. Run 'npm run setup' to create and configure a test wallet
  2. Ensure your wallet file exists at ${require('os').homedir()}/.config/solana/test-authority.json
  3. Check that your local Solana validator is running
`); 