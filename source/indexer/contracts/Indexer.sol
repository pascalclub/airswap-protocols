/*
  Copyright 2019 Swap Holdings Ltd.

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

pragma solidity 0.5.12;
pragma experimental ABIEncoderV2;

import "@airswap/indexer/contracts/interfaces/IIndexer.sol";
import "@airswap/indexer/contracts/interfaces/ILocatorWhitelist.sol";
import "@airswap/index/contracts/Index.sol";
import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "openzeppelin-solidity/contracts/ownership/Ownable.sol";

/**
  * @title Indexer: A Collection of Index contracts by Token Pair
  */
contract Indexer is IIndexer, Ownable {

  // Token to be used for staking (ERC-20)
  IERC20 public stakingToken;

  // Mapping of signer token to sender token to index
  mapping (address => mapping (address => Index)) public indexes;

  // Mapping of token address to boolean
  mapping (address => bool) public blacklist;

  // The whitelist contract for checking whether a peer is whitelisted
  address public locatorWhitelist;

  // Boolean marking when the contract is paused - users cannot call functions when true
  bool public contractPaused = false;

  /**
    * @notice Contract Constructor
    * @param indexerStakingToken address
    */
  constructor(
    address indexerStakingToken
  ) public {
    stakingToken = IERC20(indexerStakingToken);
  }

  /**
    * @notice Modifier to prevent function calling unless the contract is not paused
    */
  modifier notPaused() {
    require(!contractPaused, "CONTRACT_IS_PAUSED");
    _;
  }

  /**
    * @notice Modifier to prevent function calling unless the contract is paused
    */
  modifier paused() {
    require(contractPaused, "CONTRACT_NOT_PAUSED");
    _;
  }

  /**
    * @notice Modifier to check an index exists
    */
  modifier indexExists(signerToken, senderToken) {
    require(indexes[signerToken][senderToken] != Index(0),
      "INDEX_DOES_NOT_EXIST");
    _;
  }

  /**
    * @notice Set the address of an ILocatorWhitelist to use
    * @dev Clear the whitelist with a null address (0x0)
    * @param newLocatorWhitelist address Locator whitelist
    */
  function setLocatorWhitelist(
    address newLocatorWhitelist
  ) external onlyOwner {
    locatorWhitelist = newLocatorWhitelist;
  }

  /**
    * @notice Create an Index (List of Locators for a Token Pair)
    * @dev Deploys a new Index contract and stores the address
    *
    * @param signerToken address Signer token for the Index
    * @param senderToken address Sender token for the Index
    */
  function createIndex(
    address signerToken,
    address senderToken
  ) external notPaused returns (address) {

    // If the Index does not exist, create it.
    if (indexes[signerToken][senderToken] == Index(0)) {
      // Create a new Index contract for the token pair.
      indexes[signerToken][senderToken] = new Index();

      emit CreateIndex(signerToken, senderToken);
    }

    // Return the address of the Index contract.
    return address(indexes[signerToken][senderToken]);
  }

  /**
    * @notice Add a Token to the Blacklist
    * @param token address Token to blacklist
    */
  function addToBlacklist(
    address token
  ) external onlyOwner {
    if (!blacklist[token]) {
      blacklist[token] = true;
      emit AddToBlacklist(token);
    }
  }

  /**
    * @notice Remove a Token from the Blacklist
    * @param token address Token to remove from the blacklist
    */
  function removeFromBlacklist(
    address token
  ) external onlyOwner {
    if (blacklist[token]) {
      blacklist[token] = false;
      emit RemoveFromBlacklist(token);
    }
  }

  /**
    * @notice Set an Intent to Trade
    * @dev Requires approval to transfer staking token for sender
    *
    * @param signerToken address Signer token of the Index being staked
    * @param senderToken address Sender token of the Index being staked
    * @param amount uint256 Amount being staked
    * @param locator bytes32 Locator of the staker
    */
  function setIntent(
    address signerToken,
    address senderToken,
    uint256 amount,
    bytes32 locator
  ) external notPaused indexExists(signerToken, senderToken) {

    // If whitelist set, ensure the locator is valid.
    if (locatorWhitelist != address(0)) {
      require(ILocatorWhitelist(locatorWhitelist).has(locator),
      "LOCATOR_NOT_WHITELISTED");
    }

    // Ensure neither of the tokens are blacklisted.
    require(!blacklist[signerToken] && !blacklist[senderToken],
      "PAIR_IS_BLACKLISTED");

    // Only transfer for staking if amount is set.
    if (amount > 0) {

      // Transfer the amount for staking.
      require(stakingToken.transferFrom(msg.sender, address(this), amount),
        "UNABLE_TO_STAKE");
    }

    emit Stake(msg.sender, signerToken, senderToken, amount);

    // Set the locator on the index.
    indexes[signerToken][senderToken].setLocator(msg.sender, amount, locator);
  }

  /**
    * @notice Unset an Intent to Trade
    * @dev Users are allowed to unstake from blacklisted indexes
    *
    * @param signerToken address Signer token of the Index being unstaked
    * @param senderToken address Sender token of the Index being staked
    */
  function unsetIntent(
    address signerToken,
    address senderToken
  ) external notPaused {
    _unsetIntent(msg.sender, signerToken, senderToken);
  }

  /**
    * @notice Unset Intent for a User
    * @dev Only callable by owner
    * @dev This can be used when contractPaused to return staked tokens to users
    *
    * @param user address
    * @param signerToken address Signer token of the Index being unstaked
    * @param senderToken address Signer token of the Index being unstaked
    */
  function unsetIntentForUser(
    address user,
    address signerToken,
    address senderToken
  ) external onlyOwner {
    _unsetIntent(user, signerToken, senderToken);
  }

  /**
    * @notice Set whether the contract is paused
    * @dev Only callable by owner
    *
    * @param newStatus bool New status of contractPaused
    */
  function setPausedStatus(bool newStatus) external onlyOwner {
    contractPaused = newStatus;
  }

  /**
    * @notice Destroy the Contract
    * @dev Only callable by owner and when contractPaused
    *
    * @param recipient address Recipient of any money in the contract
    */
  function killContract(address payable recipient) external onlyOwner paused {
    selfdestruct(recipient);
  }

  /**
    * @notice Get the locators of those trading a token pair
    * @dev Users are allowed to unstake from blacklisted indexes
    *
    * @param signerToken address Signer token of the trading pair
    * @param senderToken address Sender token of the trading pair
    * @param startAddress address Address to start from
    * @param count uint256 Total number of locators to return
    * @return locators bytes32[]
    */
  function getLocators(
    address signerToken,
    address senderToken,
    address startAddress,
    uint256 count
  ) external view notPaused returns (
    bytes32[] memory locators
  ) {
    // Ensure neither token is blacklisted.
    if (blacklist[signerToken] || blacklist[senderToken]) {
      return new bytes32[](0);
    }

    // Ensure the index exists.
    if (indexes[signerToken][senderToken] == Index(0)) {
      return new bytes32[](0);
    }

    // Return an array of locators for the index.
    return indexes[signerToken][senderToken].getLocators(startAddress, count);
  }

  /**
    * @notice Gets the Stake Amount for a User
    * @param user address User who staked
    * @param signerToken address Signer token the user staked on
    * @param senderToken address Sender token the user staked on
    * @return uint256 Amount the user staked
    */
  function getStakedAmount(
    address user,
    address signerToken,
    address senderToken
  ) public view indexExists(signerToken, senderToken) returns (uint256) {

    // Return the score, equivalent to the stake amount.
    return indexes[signerToken][senderToken].getScore(user);
  }

  /**
    * @notice Unset intents and return staked tokens
    * @param user address Address of the user who staked
    * @param signerToken address Signer token of the trading pair
    * @param senderToken address Sender token of the trading pair
    */
  function _unsetIntent(
    address user,
    address signerToken,
    address senderToken
  ) internal indexExists(signerToken, senderToken) {

     // Get the score for the user.
    uint256 score = indexes[signerToken][senderToken].getScore(user);

    // Unset the locator on the index.
    indexes[signerToken][senderToken].unsetLocator(user);

    if (score > 0) {
      // Return the staked tokens. Reverts on failure.
      require(stakingToken.transfer(user, score));
    }

    emit Unstake(user, signerToken, senderToken, score);
  }

}
