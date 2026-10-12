//! Proof of Ant — PoW "ant mining" on Solana.
//!
//! Miners search for a nonce such that
//!     h = sha256(epoch.challenge ‖ miner_wallet ‖ miner.counter_le ‖ nonce_le)
//! has its first 8 bytes (big-endian u64) below `epoch.target`.
//! Each valid hash hatches an ant whose caste depends on how far below the
//! target the hash landed. Castes give shares; at the end of an epoch a slice
//! of the reward vault (filled by creator-fee buybacks) is split by shares.
//!
//! Every hatched ant is chained into `colony.tip` — a sequential, on-chain
//! hash chain (the "pheromone trail", a tiny Proof of History).

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{hash::hashv, sysvar};
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};

declare_id!("6XpBQEvCBfx4WM1iGDpUyFGkGXVTXXxcp7pvV6uZEhUU");

pub const COLONY_SEED: &[u8] = b"colony";
pub const VAULT_SEED: &[u8] = b"vault";
pub const EPOCH_SEED: &[u8] = b"epoch";
pub const MINER_SEED: &[u8] = b"miner";
pub const WORK_SEED: &[u8] = b"work";

/// Caste thresholds: extra leading zero bits below the target.
pub const SOLDIER_BITS: u32 = 4;
pub const WINGED_BITS: u32 = 8;
pub const QUEEN_BITS: u32 = 16;
/// Shares per caste (worker, soldier, winged, queen) ≈ 2^extra_bits, so the
/// expected reward stays proportional to the work done.
pub const CASTE_SHARES: [u64; 4] = [1, 16, 256, 65_536];

/// Max change of the target per retarget (×2 easier / ÷2 harder), so a few
/// empty or noisy epochs can't swing difficulty by orders of magnitude.
pub const MAX_RETARGET_FACTOR: u128 = 2;
pub const BPS_DENOMINATOR: u128 = 10_000;

#[program]
pub mod proof_of_ant {
    use super::*;

    /// Create a colony for a token mint, with its reward vault and epoch 0.
    pub fn init_colony(ctx: Context<InitColony>, params: ColonyParams) -> Result<()> {
        params.validate()?;
        let now = Clock::get()?.unix_timestamp;

        let colony = &mut ctx.accounts.colony;
        colony.authority = ctx.accounts.authority.key();
        colony.mint = ctx.accounts.mint.key();
        colony.vault = ctx.accounts.vault.key();
        colony.bump = ctx.bumps.colony;
        colony.vault_bump = ctx.bumps.vault;
        colony.epoch = 0;
        colony.reserved = 0;
        colony.total_ants = 0;
        colony.tip = [0u8; 32];
        colony.apply(&params);

        let challenge = new_challenge(&ctx.accounts.slot_hashes, &colony.tip, 0)?;
        let epoch = &mut ctx.accounts.epoch;
        epoch.colony = colony.key();
        epoch.index = 0;
        epoch.challenge = challenge;
        epoch.start_ts = now;
        epoch.target = params.initial_target;
        epoch.bump = ctx.bumps.epoch;

        emit!(EpochStarted {
            colony: colony.key(),
            index: 0,
            challenge,
            target: epoch.target,
        });
        Ok(())
    }

    /// Submit a proof of work. On success an ant hatches.
    pub fn dig(ctx: Context<Dig>, nonce: u64) -> Result<()> {
        let colony = &mut ctx.accounts.colony;
        let epoch = &mut ctx.accounts.epoch;
        let miner = &mut ctx.accounts.miner;
        let work = &mut ctx.accounts.work;
        let owner = ctx.accounts.owner.key();
        let digger = ctx.accounts.digger.key();

        require!(
            ctx.accounts.owner_token.amount >= colony.min_hold,
            AntError::NotEnoughFood
        );

        if miner.owner == Pubkey::default() {
            miner.owner = owner;
            miner.colony = colony.key();
            miner.bump = ctx.bumps.miner;
        }
        require!(
            digger == owner || (miner.session != Pubkey::default() && digger == miner.session),
            AntError::NotYourAnt
        );
        if work.owner == Pubkey::default() {
            work.owner = owner;
            work.epoch = epoch.index;
            work.bump = ctx.bumps.work;
        }
        require!(
            work.ants < colony.max_ants_per_epoch,
            AntError::EpochCapReached
        );

        let hash = hashv(&[
            &epoch.challenge,
            owner.as_ref(),
            &miner.counter.to_le_bytes(),
            &nonce.to_le_bytes(),
        ])
        .to_bytes();
        let h = u64::from_be_bytes(hash[..8].try_into().unwrap());
        let caste = caste_of(h, epoch.target).ok_or(AntError::WeakProof)?;
        let shares = CASTE_SHARES[caste as usize];

        // The counter makes every solution single-use for this wallet.
        miner.counter += 1;
        miner.total_ants += 1;
        miner.castes[caste as usize] += 1;

        work.ants += 1;
        work.shares += shares;

        epoch.ants += 1;
        epoch.shares += shares;

        colony.total_ants += 1;
        colony.tip = hashv(&[&colony.tip, &hash]).to_bytes();

        emit!(AntHatched {
            colony: colony.key(),
            owner,
            epoch: epoch.index,
            caste,
            shares,
            hash,
            tip: colony.tip,
        });
        Ok(())
    }

    /// Permissionless crank: close the current epoch once its time is up,
    /// lock its reward budget, retarget difficulty and open the next epoch.
    pub fn advance_epoch(ctx: Context<AdvanceEpoch>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let colony = &mut ctx.accounts.colony;
        let current = &mut ctx.accounts.current_epoch;

        let elapsed = now - current.start_ts;
        require!(elapsed >= colony.epoch_duration, AntError::EpochNotOver);

        let free = ctx.accounts.vault.amount.saturating_sub(colony.reserved);
        let budget = if current.shares > 0 {
            (free as u128 * colony.emission_bps as u128 / BPS_DENOMINATOR) as u64
        } else {
            0
        };
        current.budget = budget;
        current.finalized = true;
        colony.reserved += budget;

        let next_target = retarget(
            current.target,
            current.ants,
            elapsed,
            colony.target_ants_per_epoch,
            colony.epoch_duration,
            colony.max_target,
        );
        let next_index = current.index + 1;
        let challenge = new_challenge(&ctx.accounts.slot_hashes, &colony.tip, next_index)?;

        let next = &mut ctx.accounts.next_epoch;
        next.colony = colony.key();
        next.index = next_index;
        next.challenge = challenge;
        next.start_ts = now;
        next.target = next_target;
        next.bump = ctx.bumps.next_epoch;
        colony.epoch = next_index;

        emit!(EpochFinalized {
            colony: colony.key(),
            index: current.index,
            ants: current.ants,
            shares: current.shares,
            budget,
        });
        emit!(EpochStarted {
            colony: colony.key(),
            index: next_index,
            challenge,
            target: next_target,
        });
        Ok(())
    }

    /// Claim the reward for one finalized epoch. Closes the work receipt and
    /// refunds its rent to the miner.
    pub fn claim(ctx: Context<Claim>, _epoch_index: u64) -> Result<()> {
        let colony = &mut ctx.accounts.colony;
        let epoch = &mut ctx.accounts.epoch;
        let work = &ctx.accounts.work;

        require!(epoch.finalized, AntError::EpochNotFinalized);

        let payout = if epoch.expired || epoch.shares == 0 {
            0
        } else {
            require!(
                ctx.accounts.owner_token.amount >= colony.min_hold,
                AntError::NotEnoughFood
            );
            (epoch.budget as u128 * work.shares as u128 / epoch.shares as u128) as u64
        };

        if payout > 0 {
            epoch.claimed += payout;
            colony.reserved -= payout;

            let mint_key = colony.mint;
            let seeds: &[&[u8]] = &[COLONY_SEED, mint_key.as_ref(), &[colony.bump]];
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.vault.to_account_info(),
                        mint: ctx.accounts.mint.to_account_info(),
                        to: ctx.accounts.owner_token.to_account_info(),
                        authority: colony.to_account_info(),
                    },
                    &[seeds],
                ),
                payout,
                ctx.accounts.mint.decimals,
            )?;
        }

        emit!(Claimed {
            colony: colony.key(),
            owner: ctx.accounts.owner.key(),
            epoch: epoch.index,
            shares: work.shares,
            amount: payout,
        });
        Ok(())
    }

    /// Permissionless: after the claim window, release the unclaimed part of
    /// an epoch's budget back into the free pool.
    pub fn expire_epoch(ctx: Context<ExpireEpoch>, _epoch_index: u64) -> Result<()> {
        let colony = &mut ctx.accounts.colony;
        let epoch = &mut ctx.accounts.epoch;

        require!(epoch.finalized, AntError::EpochNotFinalized);
        require!(!epoch.expired, AntError::AlreadyExpired);
        require!(
            colony.epoch >= epoch.index + colony.claim_window,
            AntError::ClaimWindowOpen
        );

        let unclaimed = epoch.budget - epoch.claimed;
        colony.reserved -= unclaimed;
        epoch.expired = true;

        emit!(EpochExpired {
            colony: colony.key(),
            index: epoch.index,
            released: unclaimed,
        });
        Ok(())
    }

    /// Authorize a session key that may `dig` on the owner's behalf, so the
    /// miner does not need a wallet popup per ant. The owner's wallet stays in
    /// the hash and keeps the ants and rewards. `Pubkey::default()` revokes.
    pub fn set_session(ctx: Context<SetSession>, session: Pubkey) -> Result<()> {
        let miner = &mut ctx.accounts.miner;
        if miner.owner == Pubkey::default() {
            miner.owner = ctx.accounts.owner.key();
            miner.colony = ctx.accounts.colony.key();
            miner.bump = ctx.bumps.miner;
        }
        miner.session = session;
        emit!(SessionSet {
            colony: miner.colony,
            owner: miner.owner,
            session,
        });
        Ok(())
    }

    /// Put bought-back tokens into the vault ("feed the colony").
    /// Anyone can call it; the event makes every buyback auditable.
    pub fn deposit_rewards(ctx: Context<DepositRewards>, amount: u64) -> Result<()> {
        require!(amount > 0, AntError::ZeroAmount);
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.depositor_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.depositor.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        emit!(RewardsDeposited {
            colony: ctx.accounts.colony.key(),
            depositor: ctx.accounts.depositor.key(),
            amount,
        });
        Ok(())
    }

    /// Authority-only tuning. Takes effect for the following epochs; the
    /// current epoch's target is left untouched.
    pub fn set_params(ctx: Context<SetParams>, params: ColonyParams) -> Result<()> {
        params.validate()?;
        ctx.accounts.colony.apply(&params);
        Ok(())
    }
}

// ───────────────────────────── helpers ─────────────────────────────

/// 0 = worker, 1 = soldier, 2 = winged, 3 = queen. `None` if h ≥ target.
pub fn caste_of(h: u64, target: u64) -> Option<u8> {
    if h >= target {
        return None;
    }
    let caste = if h < target >> QUEEN_BITS {
        3
    } else if h < target >> WINGED_BITS {
        2
    } else if h < target >> SOLDIER_BITS {
        1
    } else {
        0
    };
    Some(caste)
}

/// Scale the target so the colony converges to `target_ants` per `duration`.
/// A bigger target means easier work; `max_target` is the difficulty floor.
pub fn retarget(target: u64, ants: u64, elapsed: i64, target_ants: u32, duration: i64, max_target: u64) -> u64 {
    let t = target as u128;
    let next = if ants == 0 {
        t * MAX_RETARGET_FACTOR
    } else {
        let num = t * target_ants as u128 * elapsed.max(1) as u128;
        let den = ants as u128 * duration.max(1) as u128;
        (num / den).clamp(t / MAX_RETARGET_FACTOR, t * MAX_RETARGET_FACTOR)
    };
    next.clamp(1, max_target.max(1) as u128) as u64
}

/// Fresh, unpredictable challenge: newest slot hash ‖ colony tip ‖ epoch index.
fn new_challenge(slot_hashes: &AccountInfo, tip: &[u8; 32], index: u64) -> Result<[u8; 32]> {
    require_keys_eq!(*slot_hashes.key, sysvar::slot_hashes::ID, AntError::BadSysvar);
    let data = slot_hashes.try_borrow_data()?;
    // Layout: u64 count, then (u64 slot, [u8; 32] hash) newest first.
    require!(data.len() >= 48, AntError::BadSysvar);
    Ok(hashv(&[&data[16..48], tip, &index.to_le_bytes()]).to_bytes())
}

// ───────────────────────────── state ─────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ColonyParams {
    pub initial_target: u64,
    /// Easiest allowed target (difficulty floor).
    pub max_target: u64,
    pub target_ants_per_epoch: u32,
    pub epoch_duration: i64,
    pub emission_bps: u16,
    pub min_hold: u64,
    pub max_ants_per_epoch: u32,
    pub claim_window: u64,
}

impl ColonyParams {
    fn validate(&self) -> Result<()> {
        require!(self.initial_target > 0, AntError::BadParams);
        require!(self.initial_target <= self.max_target, AntError::BadParams);
        require!(self.target_ants_per_epoch > 0, AntError::BadParams);
        require!(self.epoch_duration > 0, AntError::BadParams);
        require!(
            self.emission_bps > 0 && self.emission_bps as u128 <= BPS_DENOMINATOR,
            AntError::BadParams
        );
        require!(self.max_ants_per_epoch > 0, AntError::BadParams);
        require!(self.claim_window > 0, AntError::BadParams);
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct Colony {
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub bump: u8,
    pub vault_bump: u8,
    /// Index of the currently open epoch.
    pub epoch: u64,
    /// Vault tokens already promised to finalized epochs.
    pub reserved: u64,
    pub total_ants: u64,
    /// Pheromone trail: tip = sha256(tip ‖ ant_hash) for every ant.
    pub tip: [u8; 32],
    /// Easiest allowed target (difficulty floor).
    pub max_target: u64,
    pub target_ants_per_epoch: u32,
    pub epoch_duration: i64,
    pub emission_bps: u16,
    pub min_hold: u64,
    pub max_ants_per_epoch: u32,
    pub claim_window: u64,
}

impl Colony {
    fn apply(&mut self, p: &ColonyParams) {
        self.max_target = p.max_target;
        self.target_ants_per_epoch = p.target_ants_per_epoch;
        self.epoch_duration = p.epoch_duration;
        self.emission_bps = p.emission_bps;
        self.min_hold = p.min_hold;
        self.max_ants_per_epoch = p.max_ants_per_epoch;
        self.claim_window = p.claim_window;
    }
}

#[account]
#[derive(InitSpace)]
pub struct Epoch {
    pub colony: Pubkey,
    pub index: u64,
    pub challenge: [u8; 32],
    pub start_ts: i64,
    pub target: u64,
    pub ants: u64,
    pub shares: u64,
    pub budget: u64,
    pub claimed: u64,
    pub finalized: bool,
    pub expired: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Miner {
    pub owner: Pubkey,
    pub colony: Pubkey,
    /// Bumped on every ant; part of the hash, so solutions are single-use.
    pub counter: u64,
    pub total_ants: u64,
    /// worker, soldier, winged, queen
    pub castes: [u64; 4],
    /// Optional key allowed to dig for this owner.
    pub session: Pubkey,
    pub bump: u8,
}

/// Per-(miner, epoch) work receipt; closed on claim, refunding rent.
#[account]
#[derive(InitSpace)]
pub struct Work {
    pub owner: Pubkey,
    pub epoch: u64,
    pub ants: u32,
    pub shares: u64,
    pub bump: u8,
}

// ───────────────────────────── accounts ─────────────────────────────

#[derive(Accounts)]
pub struct InitColony<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        init,
        payer = authority,
        space = 8 + Colony::INIT_SPACE,
        seeds = [COLONY_SEED, mint.key().as_ref()],
        bump,
    )]
    pub colony: Account<'info, Colony>,
    #[account(
        init,
        payer = authority,
        seeds = [VAULT_SEED, colony.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = colony,
        token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init,
        payer = authority,
        space = 8 + Epoch::INIT_SPACE,
        seeds = [EPOCH_SEED, colony.key().as_ref(), &0u64.to_le_bytes()],
        bump,
    )]
    pub epoch: Account<'info, Epoch>,
    /// CHECK: address checked in `new_challenge`; read raw (too big to deserialize).
    pub slot_hashes: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Dig<'info> {
    /// The owner itself or its session key; pays fees and rent.
    #[account(mut)]
    pub digger: Signer<'info>,
    /// CHECK: the wallet the ant belongs to; authorized against `digger` in the handler.
    pub owner: UncheckedAccount<'info>,
    #[account(mut, seeds = [COLONY_SEED, colony.mint.as_ref()], bump = colony.bump)]
    pub colony: Account<'info, Colony>,
    #[account(
        mut,
        seeds = [EPOCH_SEED, colony.key().as_ref(), &colony.epoch.to_le_bytes()],
        bump = epoch.bump,
    )]
    pub epoch: Account<'info, Epoch>,
    #[account(
        init_if_needed,
        payer = digger,
        space = 8 + Miner::INIT_SPACE,
        seeds = [MINER_SEED, colony.key().as_ref(), owner.key().as_ref()],
        bump,
    )]
    pub miner: Account<'info, Miner>,
    #[account(
        init_if_needed,
        payer = digger,
        space = 8 + Work::INIT_SPACE,
        seeds = [WORK_SEED, colony.key().as_ref(), &colony.epoch.to_le_bytes(), owner.key().as_ref()],
        bump,
    )]
    pub work: Account<'info, Work>,
    #[account(token::mint = colony.mint, token::authority = owner)]
    pub owner_token: InterfaceAccount<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetSession<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [COLONY_SEED, colony.mint.as_ref()], bump = colony.bump)]
    pub colony: Account<'info, Colony>,
    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + Miner::INIT_SPACE,
        seeds = [MINER_SEED, colony.key().as_ref(), owner.key().as_ref()],
        bump,
    )]
    pub miner: Account<'info, Miner>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdvanceEpoch<'info> {
    #[account(mut)]
    pub cranker: Signer<'info>,
    #[account(mut, seeds = [COLONY_SEED, colony.mint.as_ref()], bump = colony.bump)]
    pub colony: Account<'info, Colony>,
    #[account(address = colony.vault)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [EPOCH_SEED, colony.key().as_ref(), &colony.epoch.to_le_bytes()],
        bump = current_epoch.bump,
    )]
    pub current_epoch: Account<'info, Epoch>,
    #[account(
        init,
        payer = cranker,
        space = 8 + Epoch::INIT_SPACE,
        seeds = [EPOCH_SEED, colony.key().as_ref(), &(colony.epoch + 1).to_le_bytes()],
        bump,
    )]
    pub next_epoch: Account<'info, Epoch>,
    /// CHECK: address checked in `new_challenge`.
    pub slot_hashes: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(epoch_index: u64)]
pub struct Claim<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [COLONY_SEED, colony.mint.as_ref()],
        bump = colony.bump,
        has_one = mint,
        has_one = vault,
    )]
    pub colony: Account<'info, Colony>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [EPOCH_SEED, colony.key().as_ref(), &epoch_index.to_le_bytes()],
        bump = epoch.bump,
    )]
    pub epoch: Account<'info, Epoch>,
    #[account(
        mut,
        close = owner,
        seeds = [WORK_SEED, colony.key().as_ref(), &epoch_index.to_le_bytes(), owner.key().as_ref()],
        bump = work.bump,
    )]
    pub work: Account<'info, Work>,
    #[account(mut, token::mint = mint, token::authority = owner)]
    pub owner_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
#[instruction(epoch_index: u64)]
pub struct ExpireEpoch<'info> {
    #[account(mut, seeds = [COLONY_SEED, colony.mint.as_ref()], bump = colony.bump)]
    pub colony: Account<'info, Colony>,
    #[account(
        mut,
        seeds = [EPOCH_SEED, colony.key().as_ref(), &epoch_index.to_le_bytes()],
        bump = epoch.bump,
    )]
    pub epoch: Account<'info, Epoch>,
}

#[derive(Accounts)]
pub struct DepositRewards<'info> {
    pub depositor: Signer<'info>,
    #[account(
        seeds = [COLONY_SEED, colony.mint.as_ref()],
        bump = colony.bump,
        has_one = mint,
        has_one = vault,
    )]
    pub colony: Account<'info, Colony>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = depositor)]
    pub depositor_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct SetParams<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [COLONY_SEED, colony.mint.as_ref()],
        bump = colony.bump,
        has_one = authority,
    )]
    pub colony: Account<'info, Colony>,
}

// ───────────────────────────── events & errors ─────────────────────────────

#[event]
pub struct AntHatched {
    pub colony: Pubkey,
    pub owner: Pubkey,
    pub epoch: u64,
    pub caste: u8,
    pub shares: u64,
    pub hash: [u8; 32],
    pub tip: [u8; 32],
}

#[event]
pub struct SessionSet {
    pub colony: Pubkey,
    pub owner: Pubkey,
    pub session: Pubkey,
}

#[event]
pub struct EpochStarted {
    pub colony: Pubkey,
    pub index: u64,
    pub challenge: [u8; 32],
    pub target: u64,
}

#[event]
pub struct EpochFinalized {
    pub colony: Pubkey,
    pub index: u64,
    pub ants: u64,
    pub shares: u64,
    pub budget: u64,
}

#[event]
pub struct EpochExpired {
    pub colony: Pubkey,
    pub index: u64,
    pub released: u64,
}

#[event]
pub struct RewardsDeposited {
    pub colony: Pubkey,
    pub depositor: Pubkey,
    pub amount: u64,
}

#[event]
pub struct Claimed {
    pub colony: Pubkey,
    pub owner: Pubkey,
    pub epoch: u64,
    pub shares: u64,
    pub amount: u64,
}

#[error_code]
pub enum AntError {
    #[msg("Signer is neither the owner nor its session key")]
    NotYourAnt,
    #[msg("Hash is not below the target")]
    WeakProof,
    #[msg("Not enough tokens held to feed an ant")]
    NotEnoughFood,
    #[msg("Per-wallet ant cap for this epoch reached")]
    EpochCapReached,
    #[msg("Epoch duration has not elapsed yet")]
    EpochNotOver,
    #[msg("Epoch is not finalized yet")]
    EpochNotFinalized,
    #[msg("Epoch already expired")]
    AlreadyExpired,
    #[msg("Claim window is still open")]
    ClaimWindowOpen,
    #[msg("Amount must be positive")]
    ZeroAmount,
    #[msg("Invalid colony parameters")]
    BadParams,
    #[msg("Wrong SlotHashes sysvar")]
    BadSysvar,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn castes() {
        let t = 1u64 << 40;
        assert_eq!(caste_of(t, t), None);
        assert_eq!(caste_of(t - 1, t), Some(0));
        assert_eq!(caste_of((t >> 4) - 1, t), Some(1));
        assert_eq!(caste_of((t >> 8) - 1, t), Some(2));
        assert_eq!(caste_of((t >> 16) - 1, t), Some(3));
    }

    #[test]
    fn retarget_bounds() {
        const M: u64 = u64::MAX;
        // Twice too many ants in the same time → target halves (harder).
        assert_eq!(retarget(1000, 20, 60, 10, 60, M), 500);
        // Half the ants → target doubles (easier).
        assert_eq!(retarget(1000, 5, 60, 10, 60, M), 2000);
        // No ants → max easing, ×2.
        assert_eq!(retarget(1000, 0, 60, 10, 60, M), 2000);
        // Huge overshoot is clamped to ÷2.
        assert_eq!(retarget(1000, 10_000, 60, 10, 60, M), 500);
        // A late crank (long epoch, few ants) still eases at most ×2.
        assert_eq!(retarget(1000, 1, 6000, 10, 60, M), 2000);
        // Difficulty floor: never easier than max_target, even after many empty epochs.
        let mut t = 1000;
        for _ in 0..20 {
            t = retarget(t, 0, 60, 10, 60, 5000);
        }
        assert_eq!(t, 5000);
        // Never overflows.
        assert_eq!(retarget(M, 0, 60, 10, 60, M), M);
    }
}
