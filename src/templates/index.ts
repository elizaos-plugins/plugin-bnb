export const getBalanceTemplate = `Given the recent messages and wallet information below:

{{recentMessages}}

{{walletInfo}}

Extract the following information about the requested check balance:
- Chain to execute on. Must be one of ["bsc", "bscTestnet", "opBNB", "opBNBTestnet"]. Default is "bsc".
- Address to check balance for. Optional, must be a valid Ethereum address starting with "0x" or a web3 domain name. If not provided, use the BNB chain Wallet Address.
- Token symbol or address. Could be a token symbol or address. If the address is provided, it must be a valid Ethereum address starting with "0x". Default is "BNB".
If any field is not provided, use the default value. If no default value is specified, use null.

Respond with an XML block containing only the extracted values. Use key-value pairs:

<response>
    <chain>SUPPORTED_CHAINS</chain>
    <address>string or null</address>
    <token>string</token>
</response>
`;

export const transferTemplate = `Given the recent messages and wallet information below:

{{recentMessages}}

{{walletInfo}}

Extract the following information about the requested transfer:
- Chain to execute on. Must be one of ["bsc", "bscTestnet", "opBNB", "opBNBTestnet"]. Default is "bsc".
- Token symbol or address(string starting with "0x"). Optional.
- Amount to transfer. Optional. Must be a string representing the amount in ether (only number without coin symbol, e.g., "0.1").
- Recipient address. Must be a valid Ethereum address starting with "0x" or a web3 domain name.
- Data. Optional, data to be included in the transaction.
If any field is not provided, use the default value. If no default value is specified, use null.

Respond with an XML block containing only the extracted values:

<response>
    <chain>SUPPORTED_CHAINS</chain>
    <token>string or null</token>
    <amount>string or null</amount>
    <toAddress>string</toAddress>
    <data>string or null</data>
</response>
`;

export const swapTemplate = `Given the recent messages and wallet information below:

{{recentMessages}}

{{walletInfo}}

Extract the following information about the requested token swap:
- Chain to execute on. Must be one of ["bsc", "bscTestnet", "opBNB", "opBNBTestnet"]. Default is "bsc".
- Input token symbol or address(string starting with "0x").
- Output token symbol or address(string starting with "0x").
- Amount to swap. Must be a string representing the amount in ether (only number without coin symbol, e.g., "0.1").
- Slippage. Optional, expressed as decimal proportion, 0.03 represents 3%.
If any field is not provided, use the default value. If no default value is specified, use null.

Respond with an XML block containing only the extracted values:

<response>
    <chain>SUPPORTED_CHAINS</chain>
    <inputToken>string or null</inputToken>
    <outputToken>string or null</outputToken>
    <amount>string or null</amount>
    <slippage>number or null</slippage>
</response>
`;

export const bridgeTemplate = `Given the recent messages and wallet information below:

{{recentMessages}}

{{walletInfo}}

Extract the following information about the requested token bridge:
- From chain. Must be one of ["bsc", "opBNB"].
- To chain. Must be one of ["bsc", "opBNB"].
- From token address. Optional, must be a valid Ethereum address starting with "0x".
- To token address. Optional, must be a valid Ethereum address starting with "0x".
- Amount to bridge. Must be a string representing the amount in ether (only number without coin symbol, e.g., "0.1").
- To address. Optional, must be a valid Ethereum address starting with "0x" or a web3 domain name.

Respond with an XML block containing only the extracted values:

<response>
    <fromChain>bsc or opBNB</fromChain>
    <toChain>bsc or opBNB</toChain>
    <fromToken>string or null</fromToken>
    <toToken>string or null</toToken>
    <amount>string</amount>
    <toAddress>string or null</toAddress>
</response>
`;

export const stakeTemplate = `Given the recent messages and wallet information below:

{{recentMessages}}

{{walletInfo}}

Extract the following information about the requested stake action:
- Chain to execute on. Must be one of ["bsc", "bscTestnet", "opBNB", "opBNBTestnet"]. Default is "bsc".
- Action to execute. Must be one of ["deposit", "withdraw", "claim"].
- Amount to execute. Optional, must be a string representing the amount in ether (only number without coin symbol, e.g., "0.1"). If the action is "deposit" or "withdraw", amount is required.
If any field is not provided, use the default value. If no default value is specified, use null.

Respond with an XML block containing only the extracted values:

<response>
    <chain>SUPPORTED_CHAINS</chain>
    <action>deposit or withdraw or claim</action>
    <amount>string or null</amount>
</response>
`;

export const faucetTemplate = `Given the recent messages and wallet information below:

{{recentMessages}}

{{walletInfo}}

Extract the following information about the requested faucet request:
- Token. Token to request. Could be one of ["BNB", "BTC", "BUSD", "DAI", "ETH", "USDC"]. Optional.
- Recipient address. Optional, must be a valid Ethereum address starting with "0x" or a web3 domain name. If not provided, use the BNB chain Wallet Address.
If any field is not provided, use the default value. If no default value is specified, use null.

Respond with an XML block containing only the extracted values:

<response>
    <token>string or null</token>
    <toAddress>string or null</toAddress>
</response>
`;

export const ercContractTemplate = `Given the recent messages and wallet information below:

{{recentMessages}}

{{walletInfo}}

When user wants to deploy any type of token contract (ERC20/721/1155), this will trigger the DEPLOY_TOKEN action.

Extract the following details for deploying a token contract:
- Chain to execute on. Must be one of ["bsc", "bscTestnet", "opBNB", "opBNBTestnet"]. Default is "bsc".
- contractType: The type of token contract to deploy
  - For ERC20: Extract name, symbol, decimals, totalSupply
  - For ERC721: Extract name, symbol, baseURI
  - For ERC1155: Extract name, baseURI
- name: The name of the token.
- symbol: The token symbol (only for ERC20/721).
- decimals: Token decimals (only for ERC20). Default is 18.
- totalSupply: Total supply with decimals (only for ERC20). Default is "1000000000000000000".
- baseURI: Base URI for token metadata (only for ERC721/1155).
If any field is not provided, use the default value. If no default value is provided, use empty string.

Respond with an XML block containing only the extracted values:

<response>
    <chain>SUPPORTED_CHAINS</chain>
    <contractType>ERC20 or ERC721 or ERC1155</contractType>
    <name>string</name>
    <symbol>string or null</symbol>
    <decimals>number or null</decimals>
    <totalSupply>string or null</totalSupply>
    <baseURI>string or null</baseURI>
</response>
`;

export const greenfieldTemplate = `Given the recent messages and wallet information below(only including 'Greenfield' keyword):

{{recentMessages}}

{{walletInfo}}

Extract the following details for Greenfield operations:
- **actionType** (string): The type of operation to perform (e.g., "createBucket", "uploadObject", "deleteObject", "crossChainTransfer")
- **bucketName** (string, optional): The name of the bucket to operate
- **objectName** (string, optional): The name of the object for upload operations
- **visibility** (string, optional): Bucket visibility setting ("private" or "public")
- **amount** (string, optional): BNB transfer to greenfield token amount.

Respond with an XML block containing only the extracted values:

<response>
    <actionType>createBucket or uploadObject or deleteObject or crossChainTransfer</actionType>
    <bucketName>string</bucketName>
    <objectName>string</objectName>
    <visibility>private or public</visibility>
    <amount>number</amount>
</response>
`;
