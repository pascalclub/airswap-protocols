const { expect } = require('chai')
const { ADDRESS_ZERO } = require('@airswap/constants')
const {
  createLightOrder,
  lightOrderToParams,
  createLightSignature,
} = require('@airswap/utils')
const { ethers, waffle } = require('hardhat')
const { deployMockContract } = waffle
const IERC20 = require('@openzeppelin/contracts/build/contracts/IERC20.json')
const IERC1155 = require('@openzeppelin/contracts/build/contracts/IERC1155.json')

describe('Light Unit Tests', () => {
  let snapshotId
  let light
  let signerToken
  let senderToken

  let deployer
  let sender
  let signer
  let anyone

  const CHAIN_ID = 31337
  const DEFAULT_AMOUNT = '10000'
  const DEFAULT_TOKEN_ID = '1'

  async function createSignedOrder(params, signer) {
    const unsignedOrder = createLightOrder({
      signerWallet: signer.address,
      signerToken: signerToken.address,
      signerAmount: DEFAULT_AMOUNT,
      senderWallet: sender.address,
      senderToken: senderToken.address,
      senderTokenId: DEFAULT_TOKEN_ID,
      senderAmount: DEFAULT_AMOUNT,
      ...params,
    })
    const sig = await createLightSignature(
      unsignedOrder,
      signer,
      light.address,
      CHAIN_ID
    )
    return lightOrderToParams({
      ...unsignedOrder,
      ...sig,
    })
  }

  beforeEach(async () => {
    snapshotId = await ethers.provider.send('evm_snapshot')
  })

  afterEach(async () => {
    await ethers.provider.send('evm_revert', [snapshotId])
  })

  before('get signers and deploy', async () => {
    ;[deployer, sender, signer, anyone] = await ethers.getSigners()

    signerToken = await deployMockContract(deployer, IERC20.abi)
    senderToken = await deployMockContract(deployer, IERC1155.abi)
    await signerToken.mock.transferFrom.returns(true)
    await senderToken.mock.safeTransferFrom.returns()

    light = await (await ethers.getContractFactory('Light')).deploy()
    await light.deployed()
  })

  describe('Test swap', async () => {
    it('test swaps', async () => {
      const order = await createSignedOrder({}, signer)
      await expect(await light.connect(sender).swap(...order)).to.emit(
        light,
        'Swap'
      )
    })

    it('test authorized signer', async () => {
      const order = await createSignedOrder(
        {
          signerWallet: anyone.address,
        },
        signer
      )

      await expect(await light.connect(anyone).authorize(signer.address))
        .to.emit(light, 'Authorize')
        .withArgs(signer.address, anyone.address)

      await expect(await light.connect(sender).swap(...order)).to.emit(
        light,
        'Swap'
      )
    })

    it('test when signer not authorized', async () => {
      const order = await createSignedOrder(
        {
          signerWallet: anyone.address,
        },
        signer
      )

      await expect(light.connect(sender).swap(...order)).to.be.revertedWith(
        'UNAUTHORIZED'
      )
    })

    it('test when order is expired', async () => {
      const order = await createSignedOrder(
        {
          expiry: '0',
        },
        signer
      )
      await expect(light.connect(sender).swap(...order)).to.be.revertedWith(
        'EXPIRY_PASSED'
      )
    })

    it('test when nonce has already been used', async () => {
      const order = await createSignedOrder(
        {
          nonce: '0',
        },
        signer
      )
      await light.connect(sender).swap(...order)
      await expect(light.connect(sender).swap(...order)).to.be.revertedWith(
        'NONCE_ALREADY_USED'
      )
    })

    it('test when nonce has been cancelled', async () => {
      const order = await createSignedOrder(
        {
          nonce: '1',
        },
        signer
      )
      await light.connect(signer).cancel([1])
      await expect(light.connect(sender).swap(...order)).to.be.revertedWith(
        'NONCE_ALREADY_USED'
      )
    })

    it('test invalid signature', async () => {
      const order = await createSignedOrder({}, signer)
      order[8] = '29' // Change "v" of signature to make invalid - index 8 is v
      await expect(light.connect(sender).swap(...order)).to.be.revertedWith(
        'INVALID_SIG'
      )
    })
  })

  describe('Test authorization', async () => {
    it('test authorized is set', async () => {
      await light.connect(anyone).authorize(signer.address)
      await expect(await light.authorized(anyone.address)).to.equal(
        signer.address
      )
    })

    it('test revoke', async () => {
      await light.connect(anyone).revoke()
      await expect(await light.authorized(anyone.address)).to.equal(
        ADDRESS_ZERO
      )
    })
  })

  describe('Test cancel', async () => {
    it('test cancellation with no items', async () => {
      await expect(await light.connect(signer).cancel([])).to.not.emit(
        light,
        'Cancel'
      )
    })

    it('test cancellation with duplicated items', async () => {
      await expect(await light.connect(signer).cancel([1, 1])).to.emit(
        light,
        'Cancel'
      )
      await expect(await light.nonceUsed(signer.address, 1)).to.equal(true)
    })

    it('test cancellation of same item twice', async () => {
      await expect(await light.connect(signer).cancel([1])).to.emit(
        light,
        'Cancel'
      )
      await expect(await light.connect(signer).cancel([1])).to.not.emit(
        light,
        'Cancel'
      )

      await expect(await light.nonceUsed(signer.address, 1)).to.equal(true)
    })

    it('test cancellation with one item', async () => {
      await expect(await light.connect(signer).cancel([1])).to.emit(
        light,
        'Cancel'
      )
      await expect(await light.nonceUsed(signer.address, 1)).to.equal(true)
    })

    it('test an array of nonces, ensure the cancellation of only those orders', async () => {
      await light.connect(signer).cancel([1, 2, 4, 6])
      await expect(await light.nonceUsed(signer.address, 1)).to.equal(true)
      await expect(await light.nonceUsed(signer.address, 2)).to.equal(true)
      await expect(await light.nonceUsed(signer.address, 3)).to.equal(false)
      await expect(await light.nonceUsed(signer.address, 4)).to.equal(true)
      await expect(await light.nonceUsed(signer.address, 5)).to.equal(false)
      await expect(await light.nonceUsed(signer.address, 6)).to.equal(true)
    })
  })
})
