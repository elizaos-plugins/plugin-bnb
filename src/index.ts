export * from "./actions/swap";
export * from "./actions/transfer";
// export * from "./actions/getBalance";
export * from "./actions/bridge";
// export * from "./actions/faucet";
export * from "./actions/deploy";
export * from "./providers/wallet";
export * from "./types";
export * from "./environment";
export * from "./actions/getBalanceTestnet";

import type { Plugin } from "@elizaos/core";
import chalk from 'chalk';
import Table from 'cli-table3';
import ora from 'ora';
import { swapAction } from "./actions/swap";
import { transferAction } from "./actions/transfer";
import { bnbWalletProvider } from "./providers/wallet";
import { getBalanceAction } from "./actions/getBalance";
import { bridgeAction } from "./actions/bridge";
import { stakeAction } from "./actions/stake";
import { faucetAction } from "./actions/faucet";
import { deployAction } from "./actions/deploy";
import { getConfig } from "./environment";

// Start the loader
const spinner = ora({
    text: chalk.cyan('Initializing BNB Plugin...'),
    spinner: 'dots12',
    color: 'cyan'
}).start();

const actions = [
    getBalanceAction,
    transferAction,
    swapAction,
    bridgeAction,
    stakeAction,
    faucetAction,
    deployAction,
];

const BNB_SPLASH = true;

// Initial banner
// Only show splash screen if BNB_SPLASH is true
if (BNB_SPLASH) {
    // Initial banner with chalk styling
    console.log(`\n${chalk.cyan('┌────────────────────────────────────────┐')}`);
    console.log(chalk.cyan('│') + chalk.yellow.bold('          BNB PLUGIN             ') + chalk.cyan(' │'));
    console.log(chalk.cyan('├────────────────────────────────────────┤'));
    console.log(chalk.cyan('│') + chalk.white('  Initializing BNB Services...    ') + chalk.cyan('│'));
    console.log(chalk.cyan('│') + chalk.white('  Version: 1.0.0                        ') + chalk.cyan('│'));
    console.log(chalk.cyan('└────────────────────────────────────────┘'));

    // Display configuration status
    const config = getConfig();
    const bscProvider = config.BSC_PROVIDER_URL ? chalk.green('✓') : chalk.red('✗');
    const bscTestnetProvider = config.BSC_TESTNET_PROVIDER_URL ? chalk.green('✓') : chalk.red('✗');
    const opbnbProvider = config.OPBNB_PROVIDER_URL ? chalk.green('✓') : chalk.red('✗');
    const wallet = config.BNB_PRIVATE_KEY || config.BNB_PUBLIC_KEY ? chalk.green('✓') : chalk.yellow('?');
    
    console.log(`\n${chalk.cyan('┌────────────────────────────────────────┐')}`);
    console.log(chalk.cyan('│') + chalk.white(' Configuration Status                 ') + chalk.cyan('│'));
    console.log(chalk.cyan('├────────────────────────────────────────┤'));
    console.log(chalk.cyan('│') + chalk.white(` BSC Provider    : ${bscProvider}                    `) + chalk.cyan('│'));
    console.log(chalk.cyan('│') + chalk.white(` BSC Testnet     : ${bscTestnetProvider}                    `) + chalk.cyan('│'));
    console.log(chalk.cyan('│') + chalk.white(` OPBNB Provider  : ${opbnbProvider}                    `) + chalk.cyan('│'));
    console.log(chalk.cyan('│') + chalk.white(` Wallet          : ${wallet}                    `) + chalk.cyan('│'));
    console.log(chalk.cyan('└────────────────────────────────────────┘'));

    // Stop the loader
    spinner.succeed(chalk.green('BNB Plugin initialized successfully!'));

    // Create a beautiful table for actions
    const actionTable = new Table({
      head: [
        chalk.cyan('Action'),
        chalk.cyan('H'),
        chalk.cyan('V'),
        chalk.cyan('E'),
        chalk.cyan('Similes')
      ],
      style: {
        head: [],
        border: ['cyan']
      }
    });

    // Format and add action information
    for (const action of actions) {
        actionTable.push([
            chalk.white(action.name),
            typeof action.handler === 'function' ? chalk.green('✓') : chalk.red('✗'),
            typeof action.validate === 'function' ? chalk.green('✓') : chalk.red('✗'),
            action.examples?.length > 0 ? chalk.green('✓') : chalk.red('✗'),
            chalk.gray(action.similes?.join(', ') || 'none')
        ]);
    }

    // Display the action table
    console.log(`\n${actionTable.toString()}`);

    // Plugin status with a nice table
    const statusTable = new Table({
      style: {
        border: ['cyan']
      }
    });

    statusTable.push(
      [chalk.cyan('Plugin Status')],
      [chalk.white('Name    : ') + chalk.yellow('plugin-bnb')],
      [chalk.white('Actions : ') + chalk.green(actions.length.toString())],
      [chalk.white('Status  : ') + chalk.green('Loaded & Ready')]
    );

    console.log(`\n${statusTable.toString()}\n`);
} else {
    // Stop the loader silently if splash is disabled
    spinner.stop();
}

// Create plugin object directly matching the Binance plugin pattern
export const bnbPlugin: Plugin = {
    name: "bnb",
    description: "BNB Smart Chain (BSC) and opBNB integration plugin supporting transfers, swaps, staking, bridging, and token deployments",
    providers: [bnbWalletProvider],
    services: [],
    actions: actions,
    evaluators: []
};

export default bnbPlugin;

