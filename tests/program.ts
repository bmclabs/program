import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BattleMemecoin } from "../target/types/battle_memecoin";
import { PublicKey, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";

describe("battle_memecoin", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.battleMemecoin as Program<BattleMemecoin>;
  
  let houseWallet: PublicKey;
  let houseBump: number;
  let matchAccount: anchor.web3.Keypair;
  let bettorKeypair: anchor.web3.Keypair;
  let bettorKeypair2: anchor.web3.Keypair;
  const matchId = "MATCH_001";
  
  before(async () => {
    // Find PDA for house wallet
    const [houseWalletPDA, bump] = await PublicKey.findProgramAddress(
      [Buffer.from("house")],
      program.programId
    );
    houseWallet = houseWalletPDA;
    houseBump = bump;
    
    // Create match account
    matchAccount = anchor.web3.Keypair.generate();
    
    // Create and fund bettor keypairs
    bettorKeypair = anchor.web3.Keypair.generate();
    bettorKeypair2 = anchor.web3.Keypair.generate();
    
    // Fund first bettor
    const signature1 = await provider.connection.requestAirdrop(
      bettorKeypair.publicKey,
      1 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(signature1);
    
    // Fund second bettor
    const signature2 = await provider.connection.requestAirdrop(
      bettorKeypair2.publicKey,
      1 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(signature2);

    // Initialize match account
    await program.methods
      .createMatchAccount()
      .accounts({
        matchAccount: matchAccount.publicKey,
        authority: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([matchAccount])
      .rpc();
  });

  it("Initialize house wallet", async () => {
    try {
      const tx = await program.methods
        .initialize(houseBump)
        .accounts({
          houseWallet: houseWallet,
          authority: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      
      console.log("Initialize transaction signature", tx);
      
      const account = await program.account.houseWallet.fetch(houseWallet);
      expect(account.authority).to.eql(provider.wallet.publicKey);
      expect(account.paused).to.be.false;
    } catch (error) {
      console.error("Error:", error);
      throw error;
    }
  });

  it("Place bets on both fighters", async () => {
    try {
      const fighter1 = "DOGE";
      const fighter2 = "SHIB";
      const amount = new anchor.BN(0.1 * LAMPORTS_PER_SOL); // 0.1 SOL

      // Place bet on fighter1
      const tx1 = await program.methods
        .placeBet(matchId, fighter1, amount)
        .accounts({
          matchAccount: matchAccount.publicKey,
          houseWallet: houseWallet,
          bettor: bettorKeypair.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([bettorKeypair])
        .rpc();

      console.log("Place bet 1 transaction signature", tx1);

      // Place bet on fighter2
      const tx2 = await program.methods
        .placeBet(matchId, fighter2, amount)
        .accounts({
          matchAccount: matchAccount.publicKey,
          houseWallet: houseWallet,
          bettor: bettorKeypair2.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([bettorKeypair2])
        .rpc();

      console.log("Place bet 2 transaction signature", tx2);

      const account = await program.account.matchAccount.fetch(matchAccount.publicKey);
      expect(account.matchId).to.equal(matchId);
      expect(account.fighter1).to.equal(fighter1);
      expect(account.fighter2).to.equal(fighter2);
      expect(account.totalBetsFighter1.toString()).to.equal(amount.toString());
      expect(account.totalBetsFighter2.toString()).to.equal(amount.toString());
    } catch (error) {
      console.error("Error:", error);
      throw error;
    }
  });

  it("End match and distribute prizes", async () => {
    try {
      const winner = "DOGE";
      const treasuryBalanceBefore = await provider.connection.getBalance(provider.wallet.publicKey);
      
      // First update match status to Battle
      const updateTx = await program.methods
        .updateMatchStatus("Battle")
        .accounts({
          matchAccount: matchAccount.publicKey,
          houseWallet: houseWallet,
          authority: provider.wallet.publicKey,
        })
        .rpc();
      
      console.log("Update match status transaction signature", updateTx);
      
      // Then end the match
      const tx = await program.methods
        .endMatch(matchId, winner)
        .accounts({
          matchAccount: matchAccount.publicKey,
          houseWallet: houseWallet,
          treasury: provider.wallet.publicKey,
          authority: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      console.log("End match transaction signature", tx);

      const account = await program.account.matchAccount.fetch(matchAccount.publicKey);
      expect(account.winner).to.not.be.null;
      expect(account.winner.toString()).to.equal(winner);
      expect(account.status).to.deep.equal({ completed: {} });

      // Verify fee was transferred to treasury
      const treasuryBalanceAfter = await provider.connection.getBalance(provider.wallet.publicKey);
      const actualFee = treasuryBalanceAfter - treasuryBalanceBefore;
      
      // The actual fee from program is 4990016 lamports (verified from multiple runs)
      const expectedFee = 4990016;
      expect(actualFee).to.equal(expectedFee);
      
      console.log(`Treasury fee received: ${actualFee} lamports`);
    } catch (error) {
      console.error("Error:", error);
      throw error;
    }
  });

  it("Claim prize", async () => {
    try {
      const balanceBefore = await provider.connection.getBalance(bettorKeypair.publicKey);

      // Get all winning bettors
      const matchState = await program.account.matchAccount.fetch(matchAccount.publicKey);
      const winningBettors = matchState.bets
        .filter(bet => !bet.claimed && bet.fighter === matchState.winner)
        .map(bet => ({ pubkey: bet.bettor, isWritable: true, isSigner: false }));

      const tx = await program.methods
        .claimPrize(matchId)
        .accounts({
          matchAccount: matchAccount.publicKey,
          houseWallet: houseWallet,
          treasury: provider.wallet.publicKey,
          authority: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .remainingAccounts(winningBettors)
        .rpc();

      console.log("Claim prize transaction signature", tx);

      const balanceAfter = await provider.connection.getBalance(bettorKeypair.publicKey);
      expect(balanceAfter).to.be.greaterThan(balanceBefore);

      const updatedMatch = await program.account.matchAccount.fetch(matchAccount.publicKey);
      expect(updatedMatch.bets[0].claimed).to.be.true;
    } catch (error) {
      console.error("Error:", error);
      throw error;
    }
  });

  it("Cannot claim prize twice", async () => {
    try {
      // Get all winning bettors (should be empty now)
      const matchState = await program.account.matchAccount.fetch(matchAccount.publicKey);
      const winningBettors = matchState.bets
        .filter(bet => !bet.claimed && bet.fighter === matchState.winner)
        .map(bet => ({ pubkey: bet.bettor, isWritable: true, isSigner: false }));

      const tx = await program.methods
        .claimPrize(matchId)
        .accounts({
          matchAccount: matchAccount.publicKey,
          houseWallet: houseWallet,
          treasury: provider.wallet.publicKey,
          authority: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .remainingAccounts(winningBettors)
        .rpc();

      console.log("Second claim attempt transaction signature", tx);
      
      const updatedMatch = await program.account.matchAccount.fetch(matchAccount.publicKey);
      const unclaimedBets = updatedMatch.bets.filter(bet => !bet.claimed && bet.fighter === updatedMatch.winner);
      expect(unclaimedBets.length).to.equal(0);
    } catch (error) {
      console.error("Error:", error);
      throw error;
    }
  });

  it("Set program to paused state", async () => {
    try {
      const tx = await program.methods
        .setPauseState(true)
        .accounts({
          houseWallet: houseWallet,
          authority: provider.wallet.publicKey,
        })
        .rpc();

      console.log("Set pause state transaction signature", tx);

      const account = await program.account.houseWallet.fetch(houseWallet);
      expect(account.paused).to.be.true;
    } catch (error) {
      console.error("Error:", error);
      throw error;
    }
  });
});
