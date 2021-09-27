const { expect } = require('chai')
const { ethers, waffle } = require('hardhat')
const BN = ethers.BigNumber
const { deployMockContract } = waffle
const IERC20 = require('@openzeppelin/contracts/build/contracts/ERC20.json')

describe('Staking Unit', () => {
  let snapshotId
  let deployer
  let account1
  let account2
  let token
  let stakingFactory
  let staking
  const DEFAULTDURATION = 100 // time in seconds

  beforeEach(async () => {
    snapshotId = await ethers.provider.send('evm_snapshot')
  })

  afterEach(async () => {
    await ethers.provider.send('evm_revert', [snapshotId])
  })

  before(async () => {
    ;[deployer, account1, account2] = await ethers.getSigners()
    token = await deployMockContract(deployer, IERC20.abi)
    stakingFactory = await ethers.getContractFactory('Staking')
    staking = await stakingFactory.deploy(
      token.address,
      'Staked AST',
      'sAST',
      DEFAULTDURATION
    )
    await staking.deployed()
  })

  describe('Default Values', async () => {
    it('constructor sets default values', async () => {
      const owner = await staking.owner()
      const name = await staking.name()
      const symbol = await staking.symbol()
      const tokenAddress = await staking.token()
      const defaultduration = await staking.vestingLength()

      expect(owner).to.equal(deployer.address)
      expect(name).to.equal('Staked AST')
      expect(symbol).to.equal('sAST')
      expect(tokenAddress).to.equal(token.address)
      expect(defaultduration).to.equal(DEFAULTDURATION)
    })
  })

  describe('Set Metadata', async () => {
    it('non owner cannot set metadata', async () => {
      await expect(
        staking.connect(account1).setMetaData('Staked AST2', 'sAST2')
      ).to.be.revertedWith('Ownable: caller is not the owner')
    })

    it('owner can set metadata', async () => {
      await staking.connect(deployer).setMetaData('Staked AST2', 'sAST2')

      const name = await staking.name()
      const symbol = await staking.symbol()
      expect(name).to.equal('Staked AST2')
      expect(symbol).to.equal('sAST2')
    })

    it('successful demicals call', async () => {
      await token.mock.decimals.returns('6')
      const decimals = await staking.connect(deployer).decimals()
      expect(decimals).to.equal(6)
    })
  })

  describe('Set Vesting Schedule', async () => {
    it('non owner cannot set vesting schedule', async () => {
      await expect(
        staking.connect(account1).setVesting(0)
      ).to.be.revertedWith('Ownable: caller is not the owner')
    })

    it('owner can set vesting schedule', async () => {
      await staking.connect(deployer).setVesting(2 * DEFAULTDURATION)

      const defaultduration = await staking.vestingLength()
      expect(defaultduration).to.equal(2 * DEFAULTDURATION)
    })

    it('Owner cannot set vesting to zero', async () => {
      await expect(
        staking.connect(deployer).setVesting(0)
      ).to.be.revertedWith('INVALID_VESTING')
    })
  })

  describe('Stake', async () => {
    it('successful staking', async () => {
      await token.mock.transferFrom.returns(true)
      await staking.connect(account1).stake('100')
      const block = await ethers.provider.getBlock()
      const userStakes = await staking
        .connect(account1)
        .getStakes(account1.address)
      expect(userStakes.balance).to.equal(100)
      expect(userStakes.timestamp).to.equal(block.timestamp)
    })

    it('successful staking for', async () => {
      await token.mock.transferFrom.returns(true)
      await staking.connect(account1).stakeFor(account2.address, '170')
      const userStakes = await staking
        .connect(account1)
        .getStakes(account2.address)
      const block = await ethers.provider.getBlock()
      expect(userStakes.balance).to.equal(170)
      expect(userStakes.duration).to.equal(DEFAULTDURATION)
      expect(userStakes.timestamp).to.equal(block.timestamp)
    })

    it('unsuccessful staking', async () => {
      await token.mock.transferFrom.revertsWithReason('Insufficient Funds')
      await expect(staking.connect(account1).stake('100')).to.be.revertedWith(
        'Insufficient Funds'
      )
    })

    it('unsuccessful staking when amount is 0', async () => {
      await expect(staking.connect(account1).stake('0')).to.be.revertedWith(
        'AMOUNT_INVALID'
      )
    })

    it('unsuccessful extend stake when amount is 0', async () => {
      await token.mock.transferFrom.returns(true)
      await staking.connect(account1).stake('100') 
      await expect(
        staking.connect(account1).stake('0')
      ).to.be.revertedWith('AMOUNT_INVALID')
    })

    it('successful extend stake when stake has been made', async () => {
      await token.mock.transferFrom.returns(true)
      await staking.connect(account1).stake('100')
      await staking.connect(account1).stake('120')

      const userStakes = await staking
        .connect(account1)
        .getStakes(account1.address)

      const block = await ethers.provider.getBlock()

      expect(userStakes.balance).to.equal(220)
      expect(userStakes.duration).to.equal(DEFAULTDURATION)
      expect(userStakes.timestamp).to.equal(block.timestamp)
    })

    it('successful extend stake and timestamp updates to appropriate value', async () => {
      await token.mock.transferFrom.returns(true)
      await staking.connect(account1).stake('100')
      const block0 = await ethers.provider.getBlock()

      // move 100000 seconds forward
      await ethers.provider.send('evm_mine', [block0.timestamp + 20])

      await staking.connect(account1).stake('120')

      const userStakes = await staking
        .connect(account1)
        .getStakes(account1.address)

      const blockNewTime = await ethers.provider.getBlockNumber()
      const blockNewTimeInfo = await ethers.provider.getBlock(blockNewTime)

      expect(userStakes.balance).to.equal(220)
      expect(userStakes.duration).to.equal(DEFAULTDURATION)

      // check if timestamp was updated appropriately
      const diff = BN.from(blockNewTimeInfo.timestamp).sub(block0.timestamp)
      const product = BN.from(120).mul(diff)
      const quotient = product.div(BN.from(220))
      // + 1 because number rounds up to nearest whole
      const sum = BN.from(block0.timestamp)
        .add(BN.from(quotient))
        .add(1)
      expect(userStakes.timestamp).to.equal(sum)
    })

    it('unsuccessful stakeFor when user staking for with an amount of 0', async () => {
      await expect(
        staking.connect(account1).stakeFor(account2.address, '0')
      ).to.be.revertedWith('AMOUNT_INVALID')
    })

    it('successful stakeFor when existing stake is not fully vested', async () => {
      await token.mock.transferFrom.returns(true)
      await staking.connect(account2).stake('100')
      await expect(
        staking.connect(account1).stakeFor(account2.address, '1')
      ).to.not.be.reverted

      const userStakes = await staking
        .connect(account1)
        .getStakes(account2.address)

      expect(userStakes.balance).to.equal(101)
      expect(userStakes.duration).to.equal(DEFAULTDURATION)
    })

    it('successful stakeFor when existing stake is fully vested', async () => {
      await token.mock.transferFrom.returns(true)
      await staking.connect(account2).stake('100')

      // move 10 seconds forward - 100% vested
      for (let index = 0; index < 100; index++) {
        await ethers.provider.send('evm_mine')
      }

      await expect(
        staking.connect(account1).stakeFor(account2.address, '1')
      ).to.not.be.reverted

      const userStakes = await staking
        .connect(account1)
        .getStakes(account2.address)

      expect(userStakes.balance).to.equal(101)
      expect(userStakes.duration).to.equal(DEFAULTDURATION)
    })
  })

  describe('Unstake', async () => {
    it('unstaking fails when attempting to claim more than is available', async () => {
      await token.mock.transferFrom.returns(true)
      await token.mock.transfer.returns(true)
      await staking.connect(account1).stake('100')

      const block = await ethers.provider.getBlock()
      await ethers.provider.send('evm_mine', [block['timestamp'] + 10])

      await expect(
        staking.connect(account1).unstake('12')
      ).to.be.revertedWith('AMOUNT_EXCEEDS_AVAILABLE')
    })

    it('successful unstaking', async () => {
      await token.mock.transferFrom.returns(true)
      await token.mock.transfer.returns(true)
      await staking.connect(account1).stake('100')

      // move 10 seconds forward - 10% vested
      for (let index = 0; index < 10; index++) {
        await ethers.provider.send('evm_mine')
      }

      await staking.connect(account1).unstake('10')
      const userStakes = await staking
        .connect(account1)
        .getStakes(account1.address)

      expect(userStakes.balance).to.equal(90)
    })

    it('successful extended stake and successful unstaking', async () => {
      await token.mock.transferFrom.returns(true)
      await token.mock.transfer.returns(true)
      await staking.connect(account1).stake('100')
      await staking.connect(account1).stake('100')

      const initialUserStake = await staking
        .connect(account1)
        .getStakes(account1.address)

      // move 10 seconds forward - 10% vested
      for (let index = 0; index < 10; index++) {
        await ethers.provider.send('evm_mine')
      }

      await staking.connect(account1).unstake('10')
      const currentUserStakes = await staking
        .connect(account1)
        .getStakes(account1.address)

      expect(initialUserStake.balance).to.equal(200)
      expect(currentUserStakes.balance).to.equal(190)
    })
  })

  describe('Available to unstake', async () => {

    it('available to unstake is > 0, if time has passed', async () => {
      await token.mock.transferFrom.returns(true)
      await token.mock.transfer.returns(true)
      await staking.connect(account1).stake('100')

      const block = await ethers.provider.getBlock()
      await ethers.provider.send('evm_mine', [block['timestamp'] + 10])

      const available = await staking.available(account1.address)
      // every 1 block 1% is vested, user can only claim starting afater 10 blocks, or 10% vested
      expect(available).to.equal('10')
    })

    it('available to unstake is > 0, if time has passed with an updated vesting schedule', async () => {
      await token.mock.transferFrom.returns(true)
      await token.mock.transfer.returns(true)
      await staking.connect(account1).stake('100')

      const block = await ethers.provider.getBlock()
      await ethers.provider.send('evm_mine', [block['timestamp'] + 10])

      await staking.connect(account1).stake('100')

      const available = await staking.available(account1.address)

      // every 1 block 2% is vested
      expect(available).to.equal('10')
    })


  })

  describe('Delegate', async () => {
    it('delegate can be set', async () => {
      await staking.connect(account1).addDelegate(account2.address)
      expect(await staking.connect(account1).isDelegate(account2.address)).to.equal(true)
      expect(await staking.connect(account1).delegateAccount(account2.address)).to.equal(account1.address)
      expect(await staking.connect(account1).accountDelegate(account1.address)).to.equal(account2.address)
    })

    it('unsuccessful delegate set if already a delegate', async () => {
      await staking.connect(account1).addDelegate(account2.address)
      await expect(staking.connect(deployer).addDelegate(account2.address)).to.be.revertedWith('ALREADY_DELEGATE')
    })

    it('unsuccessful delegate set if delegate already staking', async () => {
      await token.mock.transferFrom.returns(true)
      await staking.connect(account2).stake('100')
      await expect(staking.connect(account1).addDelegate(account2.address)).to.be.revertedWith('ALREADY_STAKING')
    })

    it('delegate can be removed', async () => {
      const zeroAddress = '0x0000000000000000000000000000000000000000'
      await staking.connect(account1).addDelegate(account2.address)
      await staking.connect(account1).removeDelegate(account2.address)
      expect(await staking.connect(account1).isDelegate(account2.address)).to.equal(false)
      expect(await staking.connect(account1).delegateAccount(account2.address)).to.equal(zeroAddress)
      expect(await staking.connect(account1).accountDelegate(account1.address)).to.equal(zeroAddress)
    })

    it('unsuccessful delegate removed if not set as delegate', async () => {
      await expect(staking.connect(account1).removeDelegate(account2.address)).to.be.revertedWith('NOT_DELEGATE')
    })

    it('successful staking with delegate', async () => {
      await token.mock.transferFrom.returns(true)
      await staking.connect(account1).addDelegate(account2.address)
      await staking.connect(account2).stake('100')
      const block = await ethers.provider.getBlock()
      const userStakes = await staking
        .connect(account2)
        .getStakes(account1.address)

      expect(userStakes.balance).to.equal(100)
      expect(userStakes.timestamp).to.equal(block.timestamp)
    })


    it('successful unstaking with delegate', async () => {
      await token.mock.transferFrom.returns(true)
      await token.mock.transfer.returns(true)
      await staking.connect(account1).addDelegate(account2.address)
      await staking.connect(account2).stake('100')

      // move 10 seconds forward - 10% vested
      for (let index = 0; index < 10; index++) {
        await ethers.provider.send('evm_mine')
      }

      const initialUserStakes = await staking
        .connect(account2)
        .getStakes(account1.address)
      await staking.connect(account2).unstake('10')
      const currentUserStakes = await staking
        .connect(account2)
        .getStakes(account1.address)

      expect(initialUserStakes.balance).to.equal(100)
      expect(currentUserStakes.balance).to.equal(90)
    })

    it('successful extended stake and successful unstaking with delegate', async () => {
      await token.mock.transferFrom.returns(true)
      await token.mock.transfer.returns(true)
      await staking.connect(account1).addDelegate(account2.address)
      await staking.connect(account2).stake('100')
      await staking.connect(account2).stake('100')

      const initialUserStake = await staking
        .connect(account2)
        .getStakes(account1.address)

      // move 10 seconds forward - 10% vested
      for (let index = 0; index < 10; index++) {
        await ethers.provider.send('evm_mine')
      }

      await staking.connect(account1).unstake('10')
      const currentUserStakes = await staking
        .connect(account2)
        .getStakes(account1.address)

      // expect(currentUserStakes.initial).to.equal(100)
      expect(initialUserStake.balance).to.equal(200)
      expect(currentUserStakes.balance).to.equal(190)
    })

  })

  describe('Balance of all stakes', async () => {
    it('get balance of all stakes', async () => {

      await token.mock.transferFrom.returns(true)
      await token.mock.transfer.returns(true)
      // stake 400 over 4 blocks
      await staking.connect(account1).stake('100')

      for (let index = 0; index < 3; index++) {
        await staking.connect(account1).stake('100')
      }
      const balance = await staking
        .connect(account1)
        .balanceOf(account1.address)
      expect(balance).to.equal('400')
    })

    it('get total supply of all stakes', async () => {

      await token.mock.transferFrom.returns(true)
      await token.mock.transfer.returns(true)
      
      // stake 400 over 4 blocks
      await staking.connect(account1).stake('100')

      for (let index = 0; index < 3; index++) {
        await staking.connect(account1).stake('100')
      }

      await staking.connect(account2).stake('100')

      const totalStakes = 
      (await staking.connect(account1).balanceOf(account1.address)) +
      (await staking.connect(account2).balanceOf(account2.address))

      await token.mock.balanceOf.returns(totalStakes)

      const totalSupply = await staking
        .connect(account1)
        .totalSupply()
      expect(totalSupply).to.equal(totalStakes)
    })
  })
})
