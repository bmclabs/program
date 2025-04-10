#!/bin/bash
set -e

# Test script for PDA-based match accounts

# Step 1: Create a new match
echo "=== Creating new match ==="
MATCH_ID="PDA_MATCH_001"
FIGHTER1="DOGE"
FIGHTER2="SHIB"

npm run create-match -- --matchid $MATCH_ID --fighter1 $FIGHTER1 --fighter2 $FIGHTER2

# Extract the match account address from the output
MATCH_ACCOUNT=$(solana address -k $(solana-keygen pubkey --derived match $MATCH_ID))
echo "Match account PDA: $MATCH_ACCOUNT"

# Step 2: Place some bets
echo -e "\n=== Placing bets ==="
npm run place-bet -- --matchaccount $MATCH_ACCOUNT --matchid $MATCH_ID --fighter $FIGHTER1 --amount 0.1
# You can add more bets here if needed

# Step 3: Update match status to Battle
echo -e "\n=== Updating match status to Battle ==="
npm run update-status -- --matchaccount $MATCH_ACCOUNT

# Step 4: End the match
echo -e "\n=== Ending match ==="
npm run end-match -- --matchaccount $MATCH_ACCOUNT --matchid $MATCH_ID --winner $FIGHTER1

# Step 5: Claim prizes
echo -e "\n=== Claiming prizes ==="
npm run claim-prize -- --matchaccount $MATCH_ACCOUNT --matchid $MATCH_ID

# Step 6: Close the match account and reclaim rent
echo -e "\n=== Closing match account ==="
npm run close-match -- --matchaccount $MATCH_ACCOUNT --matchid $MATCH_ID

echo -e "\n=== Test completed successfully ===" 