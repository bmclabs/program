use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke, system_instruction};

declare_id!("F5wQsBbjHAViAimLojNZRCxdecvHnUTfWqKnLCz2Bdho");

#[program]
pub mod battle_memecoin_club {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, bump: u8) -> Result<()> {
        let house_wallet = &mut ctx.accounts.house_wallet;
        house_wallet.bump = bump;
        house_wallet.authority = ctx.accounts.authority.key();
        house_wallet.paused = false;
        house_wallet.initialized = true;
        
        msg!("House wallet initialized with authority: {:?}", house_wallet.authority);
        Ok(())
    }

    pub fn create_match_account(ctx: Context<CreateMatchAccount>, match_id: String, fighter1: String, fighter2: String) -> Result<()> {
        require!(!ctx.accounts.house_wallet.paused, BattleError::ProgramPaused);
        require!(is_authorized(ctx.accounts.authority.key(), &ctx.accounts.house_wallet), BattleError::Unauthorized);

        require!(match_id.len() <= 32, BattleError::InvalidMatchIdLength);
        require!(fighter1.len() <= 10, BattleError::InvalidFighterLength);
        require!(fighter2.len() <= 10, BattleError::InvalidFighterLength);
        
        let match_account = &mut ctx.accounts.match_account;
        match_account.match_id = match_id.clone();
        match_account.fighter1 = fighter1.clone();
        match_account.fighter2 = fighter2.clone();
        match_account.total_bets_fighter1 = 0;
        match_account.total_bets_fighter2 = 0;
        match_account.status = MatchStatus::Preparation;
        match_account.winner = None;
        match_account.prize_pool = 0;
        match_account.bets = Vec::new();
        match_account.bump = ctx.bumps.match_account;
        
        msg!("Match account created with ID: {}, Fighter1: {}, Fighter2: {}", match_id, fighter1, fighter2);
        Ok(())
    }

    pub fn place_bet(ctx: Context<PlaceBet>, match_id: String, fighter: String, amount: u64) -> Result<()> {
        require!(!ctx.accounts.house_wallet.paused, BattleError::ProgramPaused);
        require!(amount >= 50_000_000, BattleError::BetTooSmall); // 0.05 SOL minimum
        
        let match_account = &mut ctx.accounts.match_account;
        
        // Validate match_id and fighter length
        require!(match_id.len() <= 32, BattleError::InvalidMatchIdLength);
        require!(fighter.len() <= 10, BattleError::InvalidFighterLength);
        
        // For a brand new match, just set the match_id and status
        if match_account.total_bets_fighter1 == 0 && match_account.total_bets_fighter2 == 0 {
            match_account.match_id = match_id.clone();
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

        // Check if bets vector has reached maximum size
        require!(match_account.bets.len() < 100, BattleError::TooManyBets);

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

        // Check which fighter the bet is for and update totals
        if fighter == match_account.fighter1 || (match_account.fighter1.is_empty() && match_account.fighter2 != fighter) {
            // If betting on fighter1 or fighter1 is empty and not betting on fighter2
            if match_account.fighter1.is_empty() {
                match_account.fighter1 = fighter.clone();
            }
            match_account.total_bets_fighter1 += amount;
        } else if fighter == match_account.fighter2 || (match_account.fighter2.is_empty() && match_account.fighter1 != fighter) {
            // If betting on fighter2 or fighter2 is empty and not betting on fighter1
            if match_account.fighter2.is_empty() {
                match_account.fighter2 = fighter.clone();
            }
            match_account.total_bets_fighter2 += amount;
        } else {
            // Invalid fighter
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

    pub fn update_match_status(ctx: Context<UpdateMatchStatus>, status: String, match_id: String) -> Result<()> {
        require!(!ctx.accounts.house_wallet.paused, BattleError::ProgramPaused);
        require!(is_authorized(ctx.accounts.authority.key(), &ctx.accounts.house_wallet), BattleError::Unauthorized);
        
        let match_account = &mut ctx.accounts.match_account;
        
        // Verify match ID
        require!(match_account.match_id == match_id, BattleError::InvalidMatchId);
        
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

    pub fn end_match(ctx: Context<EndMatch>, match_id: String, winner: String) -> Result<()> {
        require!(!ctx.accounts.house_wallet.paused, BattleError::ProgramPaused);
        require!(is_authorized(ctx.accounts.authority.key(), &ctx.accounts.house_wallet), BattleError::Unauthorized);
        
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
        require!(is_authorized(ctx.accounts.authority.key(), &ctx.accounts.house_wallet), BattleError::Unauthorized);
        
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
        let remaining_accounts = ctx.remaining_accounts.iter().collect::<Vec<_>>();
        let mut total_claimed = 0;
        let mut claimed_count = 0;
        
        for bet in match_account.bets.iter_mut() {
            if !bet.claimed && bet.fighter == winner {
                // Find the bettor account in remaining accounts
                let mut bettor_account_opt = None;
                for account in remaining_accounts.iter() {
                    if account.key() == bet.bettor {
                        bettor_account_opt = Some(*account);
                        break;
                    }
                }
                
                let bettor_account = bettor_account_opt
                    .ok_or(error!(BattleError::InvalidRemainingAccounts))?;
                
                // Calculate prize share with overflow protection
                let prize_share = calculate_prize_share(bet.amount, prize_pool, total_winning_bets)?;
                let total_payout = bet.amount.checked_add(prize_share)
                    .ok_or(BattleError::Overflow)?;
                
                // Transfer prize directly to bettor
                let house_wallet_info = ctx.accounts.house_wallet.to_account_info();
                let transfer_result = house_wallet_info.try_borrow_mut_lamports();
                if let Err(err) = transfer_result {
                    msg!("Failed to borrow house wallet lamports: {}", err);
                    continue;
                }
                
                let receiver_result = bettor_account.try_borrow_mut_lamports();
                if let Err(err) = receiver_result {
                    msg!("Failed to borrow bettor account lamports: {}", err);
                    continue;
                }
                
                let house_lamports = &mut **transfer_result.unwrap();
                if *house_lamports < total_payout {
                    msg!(
                        "Insufficient funds in house wallet to pay prize to bettor: {}, Amount: {}",
                        bet.bettor,
                        total_payout
                    );
                    continue;
                }
                
                *house_lamports -= total_payout;
                **receiver_result.unwrap() += total_payout;
                
                // Mark as claimed only if transfer was successful
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
        require!(is_authorized(ctx.accounts.authority.key(), &ctx.accounts.house_wallet), BattleError::Unauthorized);
        
        let match_account = &mut ctx.accounts.match_account;
        require!(match_account.match_id == match_id, BattleError::InvalidMatchId);
        require!(match_account.status == MatchStatus::Refund, BattleError::NotRefundable);
        
        // Process all unclaimed refunds
        let remaining_accounts = ctx.remaining_accounts.iter().collect::<Vec<_>>();
        let mut total_refunded = 0;
        let mut refunded_count = 0;
        
        for bet in match_account.bets.iter_mut() {
            if !bet.claimed {
                // Find the bettor account in remaining accounts
                let mut bettor_account_opt = None;
                for account in remaining_accounts.iter() {
                    if account.key() == bet.bettor {
                        bettor_account_opt = Some(*account);
                        break;
                    }
                }
                
                let bettor_account = bettor_account_opt
                    .ok_or(error!(BattleError::InvalidRemainingAccounts))?;
                
                // Transfer refund directly to bettor
                let house_wallet_info = ctx.accounts.house_wallet.to_account_info();
                let transfer_result = house_wallet_info.try_borrow_mut_lamports();
                if let Err(err) = transfer_result {
                    msg!("Failed to borrow house wallet lamports: {}", err);
                    continue;
                }
                
                let receiver_result = bettor_account.try_borrow_mut_lamports();
                if let Err(err) = receiver_result {
                    msg!("Failed to borrow bettor account lamports: {}", err);
                    continue;
                }
                
                let house_lamports = &mut **transfer_result.unwrap();
                if *house_lamports < bet.amount {
                    msg!(
                        "Insufficient funds in house wallet to refund bettor: {}, Amount: {}",
                        bet.bettor,
                        bet.amount
                    );
                    continue;
                }
                
                *house_lamports -= bet.amount;
                **receiver_result.unwrap() += bet.amount;
                
                // Mark as claimed only if transfer was successful
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
        require!(is_authorized(ctx.accounts.authority.key(), &ctx.accounts.house_wallet), BattleError::Unauthorized);
        
        let house_wallet = &mut ctx.accounts.house_wallet;
        house_wallet.paused = paused;
        msg!("Program pause state set to: {}", paused);
        
        Ok(())
    }

    pub fn emergency_refund(ctx: Context<EmergencyRefund>, match_id: String) -> Result<()> {
        require!(is_authorized(ctx.accounts.authority.key(), &ctx.accounts.house_wallet), BattleError::Unauthorized);
        
        let match_account = &mut ctx.accounts.match_account;
        require!(match_account.match_id == match_id, BattleError::InvalidMatchId);
        require!(match_account.status != MatchStatus::Completed, BattleError::MatchAlreadyCompleted);
        
        // Process all unclaimed refunds
        let remaining_accounts = ctx.remaining_accounts.iter().collect::<Vec<_>>();
        let mut total_refunded = 0;
        let mut refunded_count = 0;
        let mut has_unclaimed_bets = false;
        
        for bet in match_account.bets.iter_mut() {
            if !bet.claimed {
                // Find the bettor account in remaining accounts
                let mut bettor_account_opt = None;
                for account in remaining_accounts.iter() {
                    if account.key() == bet.bettor {
                        bettor_account_opt = Some(*account);
                        break;
                    }
                }
                
                let bettor_account = bettor_account_opt
                    .ok_or(error!(BattleError::InvalidRemainingAccounts))?;
                
                // Transfer refund directly to bettor with error handling
                let house_wallet_info = ctx.accounts.house_wallet.to_account_info();
                let transfer_result = house_wallet_info.try_borrow_mut_lamports();
                if let Err(err) = transfer_result {
                    msg!("Failed to borrow house wallet lamports: {}", err);
                    has_unclaimed_bets = true;
                    continue;
                }
                
                let receiver_result = bettor_account.try_borrow_mut_lamports();
                if let Err(err) = receiver_result {
                    msg!("Failed to borrow bettor account lamports: {}", err);
                    has_unclaimed_bets = true;
                    continue;
                }
                
                let house_lamports = &mut **transfer_result.unwrap();
                if *house_lamports < bet.amount {
                    msg!(
                        "Insufficient funds in house wallet to refund bettor: {}, Amount: {}",
                        bet.bettor,
                        bet.amount
                    );
                    has_unclaimed_bets = true;
                    continue;
                }
                
                *house_lamports -= bet.amount;
                **receiver_result.unwrap() += bet.amount;
                
                // Mark as claimed only if transfer was successful
                bet.claimed = true;
                total_refunded += bet.amount;
                refunded_count += 1;
                
                msg!(
                    "Emergency refund sent - Bettor: {}, Amount: {}",
                    bet.bettor,
                    bet.amount
                );
            }
        }
        
        // Check if all bets are claimed before setting match status to Refund
        let all_claimed = !has_unclaimed_bets && match_account.bets.iter().all(|bet| bet.claimed);
        
        if all_claimed {
            // Only update match status if all bets are claimed
            match_account.status = MatchStatus::Refund;
            msg!("All bets have been refunded. Match status updated to Refund.");
        } else {
            msg!("Not all bets have been refunded. Match status remains unchanged.");
        }
        
        if total_refunded > 0 {
            msg!(
                "Total emergency refunds distributed - Match: {}, Count: {}, Total Amount: {}",
                match_id,
                refunded_count,
                total_refunded
            );
        } else {
            msg!("No unclaimed refunds found");
        }

        Ok(())
    }

    pub fn transfer_from_house_wallet(
        ctx: Context<TransferFromHouseWallet>, 
        amount: u64
    ) -> Result<()> {
        require!(is_authorized(ctx.accounts.authority.key(), &ctx.accounts.house_wallet), BattleError::Unauthorized);
        
        // Transfer SOL directly from house wallet to recipient
        **ctx.accounts.house_wallet.to_account_info().try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.recipient.try_borrow_mut_lamports()? += amount;
        
        msg!(
            "House wallet transfer - To: {}, Amount: {}",
            ctx.accounts.recipient.key(),
            amount
        );
        
        Ok(())
    }

    pub fn reclaim_prize(ctx: Context<ClaimPrize>, match_id: String, bettor_pubkey: Pubkey) -> Result<()> {
        require!(!ctx.accounts.house_wallet.paused, BattleError::ProgramPaused);
        require!(is_authorized(ctx.accounts.authority.key(), &ctx.accounts.house_wallet), BattleError::Unauthorized);
        
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
        
        // Find the specific bettor in the bet list
        let mut found = false;
        let mut total_claimed = 0;
        
        for bet in match_account.bets.iter_mut() {
            if !bet.claimed && bet.fighter == winner && bet.bettor == bettor_pubkey {
                found = true;
                
                // Find the bettor account in remaining accounts
                let mut bettor_account_opt = None;
                for account in ctx.remaining_accounts.iter() {
                    if account.key() == bettor_pubkey {
                        bettor_account_opt = Some(account);
                        break;
                    }
                }
                
                let bettor_account = bettor_account_opt
                    .ok_or(error!(BattleError::InvalidRemainingAccounts))?;
                
                // Calculate prize share with overflow protection
                let prize_share = calculate_prize_share(bet.amount, prize_pool, total_winning_bets)?;
                let total_payout = bet.amount.checked_add(prize_share)
                    .ok_or(BattleError::Overflow)?;
                
                // Transfer prize directly to bettor
                let house_wallet_info = ctx.accounts.house_wallet.to_account_info();
                let transfer_result = house_wallet_info.try_borrow_mut_lamports();
                if let Err(err) = transfer_result {
                    msg!("Failed to borrow house wallet lamports: {}", err);
                    return err!(BattleError::TransferFailed);
                }
                
                let receiver_result = bettor_account.try_borrow_mut_lamports();
                if let Err(err) = receiver_result {
                    msg!("Failed to borrow bettor account lamports: {}", err);
                    return err!(BattleError::TransferFailed);
                }
                
                let house_lamports = &mut **transfer_result.unwrap();
                if *house_lamports < total_payout {
                    msg!(
                        "Insufficient funds in house wallet to pay prize to bettor: {}, Amount: {}",
                        bet.bettor,
                        total_payout
                    );
                    return err!(BattleError::InsufficientFunds);
                }
                
                *house_lamports -= total_payout;
                **receiver_result.unwrap() += total_payout;
                
                // Mark as claimed only if transfer was successful
                bet.claimed = true;
                total_claimed += total_payout;
                
                msg!(
                    "Prize reclaimed - Bettor: {}, Amount: {}, Prize Share: {}",
                    bet.bettor,
                    bet.amount,
                    prize_share
                );
                
                break;
            }
        }
        
        require!(found, BattleError::NoBet);
        
        if total_claimed > 0 {
            msg!(
                "Prize reclaimed for bettor: {}, Amount: {}",
                bettor_pubkey,
                total_claimed
            );
        } else {
            msg!("No prize claimed");
        }

        Ok(())
    }

    pub fn close_match_account(ctx: Context<CloseMatchAccount>, match_id: String) -> Result<()> {
        require!(is_authorized(ctx.accounts.authority.key(), &ctx.accounts.house_wallet), BattleError::Unauthorized);
        
        let match_account = &ctx.accounts.match_account;
        require!(match_account.match_id == match_id, BattleError::InvalidMatchId);
        
        // Match must be completed or refunded to be closed
        require!(
            match_account.status == MatchStatus::Completed || match_account.status == MatchStatus::Refund,
            BattleError::MatchNotFinalized
        );
        
        // If completed, all prizes must be claimed
        if match_account.status == MatchStatus::Completed {
            let all_claimed = match_account.bets.iter().all(|bet| {
                bet.claimed || 
                match_account.winner.as_ref().map_or(false, |winner| bet.fighter != *winner)
            });
            
            require!(all_claimed, BattleError::UnclaimedPrizes);
        }
        
        // If refunded, all refunds must be claimed
        if match_account.status == MatchStatus::Refund {
            let all_claimed = match_account.bets.iter().all(|bet| bet.claimed);
            require!(all_claimed, BattleError::UnclaimedRefunds);
        }
        
        msg!("Match account closed: {}", match_id);
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
#[instruction(match_id: String, fighter: String, amount: u64)]
pub struct PlaceBet<'info> {
    #[account(
        mut,
        seeds = [b"match", match_id.as_bytes()],
        bump = match_account.bump
    )]
    pub match_account: Account<'info, MatchAccount>,
    
    #[account(mut)]
    pub house_wallet: Account<'info, HouseWallet>,
    
    #[account(mut)]
    pub bettor: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(match_id: String, winner: String)]
pub struct EndMatch<'info> {
    #[account(
        mut,
        seeds = [b"match", match_id.as_bytes()],
        bump = match_account.bump
    )]
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
#[instruction(match_id: String)]
pub struct ClaimPrize<'info> {
    #[account(
        mut,
        seeds = [b"match", match_id.as_bytes()],
        bump = match_account.bump
    )]
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
#[instruction(match_id: String)]
pub struct ClaimRefund<'info> {
    #[account(
        mut,
        seeds = [b"match", match_id.as_bytes()],
        bump = match_account.bump
    )]
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
#[instruction(status: String, match_id: String)]
pub struct UpdateMatchStatus<'info> {
    #[account(
        mut,
        seeds = [b"match", match_id.as_bytes()],
        bump = match_account.bump
    )]
    pub match_account: Account<'info, MatchAccount>,
    
    #[account(mut)]
    pub house_wallet: Account<'info, HouseWallet>,
    
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(match_id: String, fighter1: String, fighter2: String)]
pub struct CreateMatchAccount<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + MatchAccount::SPACE,
        seeds = [b"match", match_id.as_bytes()],
        bump
    )]
    pub match_account: Account<'info, MatchAccount>,
    
    #[account(mut)]
    pub house_wallet: Account<'info, HouseWallet>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(match_id: String)]
pub struct EmergencyRefund<'info> {
    #[account(
        mut,
        seeds = [b"match", match_id.as_bytes()],
        bump = match_account.bump
    )]
    pub match_account: Account<'info, MatchAccount>,
    
    #[account(mut)]
    pub house_wallet: Account<'info, HouseWallet>,
    
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct TransferFromHouseWallet<'info> {
    #[account(mut)]
    pub house_wallet: Account<'info, HouseWallet>,
    
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
    
    /// CHECK: This account will receive the funds
    #[account(mut)]
    pub recipient: AccountInfo<'info>,
}

#[derive(Accounts)]
#[instruction(match_id: String)]
pub struct CloseMatchAccount<'info> {
    #[account(
        mut,
        seeds = [b"match", match_id.as_bytes()],
        bump = match_account.bump,
        close = authority
    )]
    pub match_account: Account<'info, MatchAccount>,
    
    #[account(mut)]
    pub house_wallet: Account<'info, HouseWallet>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[account]
pub struct HouseWallet {
    pub authority: Pubkey,
    pub bump: u8,
    pub paused: bool,
    pub initialized: bool,
}

impl HouseWallet {
    pub const SPACE: usize = 32 + 1 + 1 + 1; // 32 bytes for authority + bump + paused + initialized
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
    pub bump: u8,
}

impl MatchAccount {
    pub const SPACE: usize = 
        32 + // match_id
        10 + // fighter1
        10 + // fighter2
        8 + // total_bets_fighter1
        8 + // total_bets_fighter2
        1 + // status
        11 + // winner (Option<String>)
        8 + // prize_pool
        4 + // Vec length (u32)
        (80 * 100) + // Space for up to 100 bets (~8,000 bytes)
        1;  // bump
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
    #[msg("Invalid match ID length")]
    InvalidMatchIdLength,
    #[msg("Invalid fighter length")]
    InvalidFighterLength,
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
    #[msg("Too many bets")]
    TooManyBets,
    #[msg("Overflow in calculation")]
    Overflow,
    #[msg("Match already completed")]
    MatchAlreadyCompleted,
    #[msg("Transfer failed")]
    TransferFailed,
    #[msg("Insufficient funds")]
    InsufficientFunds,
    #[msg("Match is not finalized")]
    MatchNotFinalized,
    #[msg("There are unclaimed prizes")]
    UnclaimedPrizes,
    #[msg("There are unclaimed refunds")]
    UnclaimedRefunds,
}

// Helper functions
fn is_authorized(authority: Pubkey, house_wallet: &HouseWallet) -> bool {
    authority == house_wallet.authority
}

fn calculate_prize_share(bet_amount: u64, prize_pool: u64, total_winning_bets: u64) -> Result<u64> {
    if total_winning_bets == 0 {
        return Ok(0);
    }
    
    let prize_share = (bet_amount as u128)
        .checked_mul(prize_pool as u128)
        .ok_or(BattleError::Overflow)?
        .checked_div(total_winning_bets as u128)
        .ok_or(BattleError::Overflow)?;
        
    Ok(prize_share as u64)
}
