use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::{invoke, invoke_signed}, system_instruction};

declare_id!("HsgW2W2TfkLWzd1VEmZjZhGdj3CadyEkCbV3qPgvzCbM");

#[program]
pub mod battle_memecoin {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, bump: u8) -> Result<()> {
        let house_wallet = &mut ctx.accounts.house_wallet;
        house_wallet.bump = bump;
        house_wallet.authority = ctx.accounts.authority.key();
        house_wallet.paused = false;
        msg!("House wallet initialized with authority: {:?}", house_wallet.authority);
        Ok(())
    }

    pub fn place_bet(ctx: Context<PlaceBet>, match_id: String, fighter: String, amount: u64) -> Result<()> {
        require!(!ctx.accounts.house_wallet.paused, BattleError::ProgramPaused);
        require!(amount >= 50_000_000, BattleError::BetTooSmall); // 0.05 SOL minimum
        
        let match_account = &mut ctx.accounts.match_account;
        
        // Initialize match if it doesn't exist
        if match_account.total_bets_fighter1 == 0 && match_account.total_bets_fighter2 == 0 {
            match_account.match_id = match_id.clone();
            match_account.fighter1 = fighter.clone();
            match_account.fighter2 = String::new();
            match_account.status = MatchStatus::Preparation;
            match_account.winner = None;
        }

        require!(match_account.status == MatchStatus::Preparation, BattleError::MatchNotInPreparation);
        require!(match_account.match_id == match_id, BattleError::InvalidMatchId);
        
        // Check if user has already bet in this match
        require!(
            !match_account.bets.iter().any(|bet| bet.bettor == ctx.accounts.bettor.key()),
            BattleError::AlreadyBet
        );

        // Transfer SOL from bettor to house wallet
        invoke(
            &system_instruction::transfer(
                ctx.accounts.bettor.key,
                ctx.accounts.house_wallet.to_account_info().key,
                amount,
            ),
            &[
                ctx.accounts.bettor.to_account_info(),
                ctx.accounts.house_wallet.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        // Record the bet
        let bet = Bet {
            bettor: ctx.accounts.bettor.key(),
            amount,
            fighter: fighter.clone(),
            claimed: false,
        };
        
        match_account.bets.push(bet);
        
        if fighter == match_account.fighter1 {
            match_account.total_bets_fighter1 += amount;
        } else if match_account.fighter2.is_empty() {
            // Set fighter2 if it hasn't been set yet
            match_account.fighter2 = fighter.clone();
            match_account.total_bets_fighter2 += amount;
        } else if fighter == match_account.fighter2 {
            match_account.total_bets_fighter2 += amount;
        } else {
            return err!(BattleError::InvalidFighter);
        }

        msg!(
            "Bet placed - Match: {}, Fighter: {}, Amount: {}, Total F1: {}, Total F2: {}",
            match_id,
            fighter,
            amount,
            match_account.total_bets_fighter1,
            match_account.total_bets_fighter2
        );

        Ok(())
    }

    pub fn end_match(ctx: Context<EndMatch>, match_id: String, winner: String) -> Result<()> {
        require!(!ctx.accounts.house_wallet.paused, BattleError::ProgramPaused);
        
        let match_account = &mut ctx.accounts.match_account;
        require!(match_account.match_id == match_id, BattleError::InvalidMatchId);
        require!(match_account.status == MatchStatus::Battle, BattleError::MatchNotInBattle);
        require!(match_account.winner.is_none(), BattleError::MatchAlreadyEnded);
        
        // Validate winner is one of the fighters
        require!(
            winner == match_account.fighter1 || winner == match_account.fighter2,
            BattleError::InvalidWinner
        );

        // If no bets on one side, refund all bets
        if match_account.total_bets_fighter1 == 0 || match_account.total_bets_fighter2 == 0 {
            match_account.status = MatchStatus::Refund;
            msg!("Match ended in refund due to no bets on one side");
            return Ok(());
        }

        let total_losing_bets = if winner == match_account.fighter1 {
            match_account.total_bets_fighter2
        } else {
            match_account.total_bets_fighter1
        };

        // Calculate fee (5% of losing bets) ensuring proper precision
        let fee = (total_losing_bets as u128 * 5 / 100) as u64;
        msg!("Debug - Total losing bets: {}, Fee calculated: {}", total_losing_bets, fee);
        
        // Transfer fee to treasury
        **ctx.accounts.house_wallet.to_account_info().try_borrow_mut_lamports()? -= fee;
        **ctx.accounts.treasury.try_borrow_mut_lamports()? += fee;

        match_account.winner = Some(winner.clone());
        match_account.prize_pool = total_losing_bets - fee;
        match_account.status = MatchStatus::Completed;

        msg!(
            "Match ended - ID: {}, Winner: {}, Prize Pool: {}, Fee transferred to treasury: {}",
            match_id,
            winner,
            match_account.prize_pool,
            fee
        );

        Ok(())
    }

    pub fn claim_prize(ctx: Context<ClaimPrize>, match_id: String) -> Result<()> {
        require!(!ctx.accounts.house_wallet.paused, BattleError::ProgramPaused);
        require!(ctx.accounts.authority.key() == ctx.accounts.house_wallet.authority, BattleError::Unauthorized);
        
        let match_account = &mut ctx.accounts.match_account;
        require!(match_account.match_id == match_id, BattleError::InvalidMatchId);
        require!(match_account.status == MatchStatus::Completed, BattleError::MatchNotCompleted);
        
        // Get all necessary values before mutable borrow
        let winner = match_account.winner.as_ref().unwrap().clone();
        let total_winning_bets = if winner == match_account.fighter1 {
            match_account.total_bets_fighter1
        } else {
            match_account.total_bets_fighter2
        };
        let prize_pool = match_account.prize_pool;
        
        // Process all unclaimed winning bets
        let mut remaining_accounts = ctx.remaining_accounts.iter();
        let mut total_claimed = 0;
        let mut claimed_count = 0;
        
        for bet in match_account.bets.iter_mut() {
            if !bet.claimed && bet.fighter == winner {
                // Get bettor's account from remaining accounts
                let bettor_account = next_account_info(&mut remaining_accounts)
                    .map_err(|_| error!(BattleError::InvalidRemainingAccounts))?;
                
                require!(
                    bettor_account.key() == bet.bettor,
                    BattleError::InvalidBettorAccount
                );
                
                // Calculate prize share
                let prize_share = (bet.amount as u128 * prize_pool as u128 / total_winning_bets as u128) as u64;
                let total_payout = bet.amount + prize_share;
                
                // Transfer prize directly to bettor
                **ctx.accounts.house_wallet.to_account_info().try_borrow_mut_lamports()? -= total_payout;
                **bettor_account.try_borrow_mut_lamports()? += total_payout;
                
                // Mark as claimed and update totals
                bet.claimed = true;
                total_claimed += total_payout;
                claimed_count += 1;
                
                msg!(
                    "Prize sent - Bettor: {}, Amount: {}, Prize Share: {}",
                    bet.bettor,
                    bet.amount,
                    prize_share
                );
            }
        }
        
        if total_claimed > 0 {
            msg!(
                "Total prizes distributed - Match: {}, Count: {}, Total Amount: {}",
                match_id,
                claimed_count,
                total_claimed
            );
        } else {
            msg!("No unclaimed prizes found");
        }

        Ok(())
    }

    pub fn claim_refund(ctx: Context<ClaimRefund>, match_id: String) -> Result<()> {
        require!(!ctx.accounts.house_wallet.paused, BattleError::ProgramPaused);
        require!(ctx.accounts.authority.key() == ctx.accounts.house_wallet.authority, BattleError::Unauthorized);
        
        let match_account = &mut ctx.accounts.match_account;
        require!(match_account.match_id == match_id, BattleError::InvalidMatchId);
        require!(match_account.status == MatchStatus::Refund, BattleError::NotRefundable);
        
        // Process all unclaimed refunds
        let mut remaining_accounts = ctx.remaining_accounts.iter();
        let mut total_refunded = 0;
        let mut refunded_count = 0;
        
        for bet in match_account.bets.iter_mut() {
            if !bet.claimed {
                // Get bettor's account from remaining accounts
                let bettor_account = next_account_info(&mut remaining_accounts)
                    .map_err(|_| error!(BattleError::InvalidRemainingAccounts))?;
                
                require!(
                    bettor_account.key() == bet.bettor,
                    BattleError::InvalidBettorAccount
                );
                
                // Transfer refund directly to bettor
                **ctx.accounts.house_wallet.to_account_info().try_borrow_mut_lamports()? -= bet.amount;
                **bettor_account.try_borrow_mut_lamports()? += bet.amount;
                
                // Mark as claimed and update totals
                bet.claimed = true;
                total_refunded += bet.amount;
                refunded_count += 1;
                
                msg!(
                    "Refund sent - Bettor: {}, Amount: {}",
                    bet.bettor,
                    bet.amount
                );
            }
        }
        
        if total_refunded > 0 {
            msg!(
                "Total refunds distributed - Match: {}, Count: {}, Total Amount: {}",
                match_id,
                refunded_count,
                total_refunded
            );
        } else {
            msg!("No unclaimed refunds found");
        }

        Ok(())
    }

    pub fn set_pause_state(ctx: Context<SetPauseState>, paused: bool) -> Result<()> {
        let house_wallet = &mut ctx.accounts.house_wallet;
        require!(ctx.accounts.authority.key() == house_wallet.authority, BattleError::Unauthorized);
        
        house_wallet.paused = paused;
        msg!("Program pause state set to: {}", paused);
        
        Ok(())
    }

    pub fn update_match_status(ctx: Context<UpdateMatchStatus>, status: String) -> Result<()> {
        require!(!ctx.accounts.house_wallet.paused, BattleError::ProgramPaused);
        require!(ctx.accounts.authority.key() == ctx.accounts.house_wallet.authority, BattleError::Unauthorized);
        
        let match_account = &mut ctx.accounts.match_account;
        
        match status.as_str() {
            "Battle" => {
                require!(match_account.status == MatchStatus::Preparation, BattleError::InvalidStatusTransition);
                match_account.status = MatchStatus::Battle;
            },
            _ => return err!(BattleError::InvalidStatus)
        }

        msg!("Match status updated to: {}", status);
        Ok(())
    }

    pub fn create_match_account(ctx: Context<CreateMatchAccount>) -> Result<()> {
        let match_account = &mut ctx.accounts.match_account;
        match_account.match_id = String::new();
        match_account.fighter1 = String::new();
        match_account.fighter2 = String::new();
        match_account.total_bets_fighter1 = 0;
        match_account.total_bets_fighter2 = 0;
        match_account.status = MatchStatus::Preparation;
        match_account.winner = None;
        match_account.prize_pool = 0;
        match_account.bets = Vec::new();
        
        msg!("Match account created");
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + HouseWallet::SPACE,
        seeds = [b"house"],
        bump
    )]
    pub house_wallet: Account<'info, HouseWallet>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PlaceBet<'info> {
    #[account(mut)]
    pub match_account: Account<'info, MatchAccount>,
    
    #[account(mut)]
    pub house_wallet: Account<'info, HouseWallet>,
    
    #[account(mut)]
    pub bettor: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct EndMatch<'info> {
    #[account(mut)]
    pub match_account: Account<'info, MatchAccount>,
    
    #[account(mut)]
    pub house_wallet: Account<'info, HouseWallet>,
    
    /// CHECK: This account will receive the fee
    #[account(mut)]
    pub treasury: AccountInfo<'info>,
    
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimPrize<'info> {
    #[account(mut)]
    pub match_account: Account<'info, MatchAccount>,
    
    #[account(mut)]
    pub house_wallet: Account<'info, HouseWallet>,
    
    /// CHECK: This account will receive the fee
    #[account(mut)]
    pub treasury: AccountInfo<'info>,
    
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimRefund<'info> {
    #[account(mut)]
    pub match_account: Account<'info, MatchAccount>,
    
    #[account(mut)]
    pub house_wallet: Account<'info, HouseWallet>,
    
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetPauseState<'info> {
    #[account(mut)]
    pub house_wallet: Account<'info, HouseWallet>,
    
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateMatchStatus<'info> {
    #[account(mut)]
    pub match_account: Account<'info, MatchAccount>,
    
    #[account(mut)]
    pub house_wallet: Account<'info, HouseWallet>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct CreateMatchAccount<'info> {
    #[account(init, payer = authority, space = 8 + MatchAccount::SPACE)]
    pub match_account: Account<'info, MatchAccount>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[account]
pub struct HouseWallet {
    pub authority: Pubkey,
    pub bump: u8,
    pub paused: bool,
}

impl HouseWallet {
    pub const SPACE: usize = 32 + 1 + 1;
}

#[account]
pub struct MatchAccount {
    pub match_id: String,
    pub fighter1: String,
    pub fighter2: String,
    pub total_bets_fighter1: u64,
    pub total_bets_fighter2: u64,
    pub status: MatchStatus,
    pub winner: Option<String>,
    pub prize_pool: u64,
    pub bets: Vec<Bet>,
}

impl MatchAccount {
    pub const SPACE: usize = 
        32 + // match_id
        32 + // fighter1
        32 + // fighter2
        8 + // total_bets_fighter1
        8 + // total_bets_fighter2
        1 + // status
        33 + // winner (Option<String>)
        8 + // prize_pool
        1000; // bets (Vec<Bet>) with some reasonable max size
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Bet {
    pub bettor: Pubkey,
    pub amount: u64,
    pub fighter: String,
    pub claimed: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum MatchStatus {
    Preparation,
    Battle,
    Completed,
    Refund,
}

#[error_code]
pub enum BattleError {
    #[msg("Program is paused")]
    ProgramPaused,
    #[msg("Bet amount is too small")]
    BetTooSmall,
    #[msg("Match is not in preparation phase")]
    MatchNotInPreparation,
    #[msg("Invalid match ID")]
    InvalidMatchId,
    #[msg("User has already placed a bet in this match")]
    AlreadyBet,
    #[msg("Invalid fighter")]
    InvalidFighter,
    #[msg("Match is not in battle phase")]
    MatchNotInBattle,
    #[msg("Match has already ended")]
    MatchAlreadyEnded,
    #[msg("Invalid winner")]
    InvalidWinner,
    #[msg("Match is not completed")]
    MatchNotCompleted,
    #[msg("No bet found for this user")]
    NoBet,
    #[msg("Prize already claimed")]
    AlreadyClaimed,
    #[msg("User did not bet on the winning fighter")]
    NotAWinner,
    #[msg("Match is not refundable")]
    NotRefundable,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Invalid status transition")]
    InvalidStatusTransition,
    #[msg("Invalid status")]
    InvalidStatus,
    #[msg("Invalid remaining accounts")]
    InvalidRemainingAccounts,
    #[msg("Invalid bettor account")]
    InvalidBettorAccount,
}
