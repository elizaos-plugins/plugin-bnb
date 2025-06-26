import {
  MsgCreateBucket,
  MsgDeleteObject,
} from '@bnb-chain/greenfield-cosmos-types/greenfield/storage/tx';
import { createRequire } from 'module';
import {
  elizaLogger,
  HandlerCallback,
  Media,
  type IAgentRuntime,
  type Memory,
  type State,
  parseKeyValueXml,
  composePromptFromState,
  ModelType,
} from '@elizaos/core';
import { readFileSync, statSync } from 'fs';
import { lookup } from 'mime-types';
import { extname } from 'node:path';
import { CONFIG, getGnfdConfig, InitGnfdClient } from '../providers/gnfd';
import { initWalletProvider, WalletProvider } from '../providers/wallet';
import { greenfieldTemplate } from '../templates';
import { DelegatedPubObjectRequest } from '@bnb-chain/greenfield-js-sdk';
import { SupportedChain } from '../types';
import { CROSS_CHAIN_ABI } from '../abi/CrossChainAbi';
import { TOKENHUB_ABI } from '../abi/TokenHubAbi';
import { parseEther, stringToHex } from 'viem';

export { greenfieldTemplate };

const require = createRequire(import.meta.url);
const { Client, Long, VisibilityType } = require('@bnb-chain/greenfield-js-sdk');

export class GreenfieldAction {
  constructor(
    private walletProvider: WalletProvider,
    private gnfdClient: typeof Client
  ) {}

  async getSps() {
    const sps = await this.gnfdClient.sp.getStorageProviders();

    return sps;
  }

  async selectSp() {
    const finalSps = await this.getSps();

    const selectIndex = Math.floor(Math.random() * finalSps.length);

    const secondarySpAddresses = [
      ...finalSps.slice(0, selectIndex),
      ...finalSps.slice(selectIndex + 1),
    ].map((item) => item.operatorAddress);
    const selectSpInfo = {
      id: finalSps[selectIndex].id,
      endpoint: finalSps[selectIndex].endpoint,
      primarySpAddress: finalSps[selectIndex]?.operatorAddress,
      sealAddress: finalSps[selectIndex].sealAddress,
      secondarySpAddresses,
    };

    return selectSpInfo;
  }

  async bnbTransferToGnfd(amount: bigint, runtime: IAgentRuntime) {
    const config = await getGnfdConfig(runtime);

    const chain: SupportedChain = config.NETWORK === 'TESTNET' ? 'bscTestnet' : 'bsc';
    this.walletProvider.switchChain(chain);
    const publicClient = this.walletProvider.getPublicClient(chain);
    const walletClient = this.walletProvider.getWalletClient(chain);

    const [relayFee, ackRelayFee] = await publicClient.readContract({
      address: config.CROSSCHAIN_ADDRESS as `0x${string}`,
      abi: CROSS_CHAIN_ABI,
      functionName: 'getRelayFees',
    });
    const relayerFee = relayFee + ackRelayFee;
    const totalAmount = relayerFee + amount;

    const { request } = await publicClient.simulateContract({
      account: this.walletProvider.getAccount(),
      address: config.TOKENHUB_ADDRESS as `0x${string}`,
      abi: TOKENHUB_ABI,
      functionName: 'transferOut',
      args: [this.walletProvider.getAddress(), amount],
      value: totalAmount,
    });

    const hash = await walletClient.writeContract(request);
    const tx = await publicClient.waitForTransactionReceipt({
      hash,
    });

    return tx.transactionHash;
  }

  async createBucket(msg: MsgCreateBucket) {
    elizaLogger.log('create bucket...');
    const createBucketTx = await this.gnfdClient.bucket.createBucket(msg);

    const createBucketTxSimulateInfo = await createBucketTx.simulate({
      denom: 'BNB',
    });

    const createBucketTxRes = await createBucketTx.broadcast({
      denom: 'BNB',
      gasLimit: Number(createBucketTxSimulateInfo?.gasLimit),
      gasPrice: createBucketTxSimulateInfo?.gasPrice || '5000000000',
      payer: msg.paymentAddress,
      granter: '',
      privateKey: this.walletProvider.getPrivateKey(),
    });

    elizaLogger.log('createBucketTxRes', createBucketTxRes);

    if (createBucketTxRes.code === 0) {
      elizaLogger.log('create bucket success');
    }
    return createBucketTxRes.transactionHash;
  }

  async headBucket(bucketName: string) {
    const { bucketInfo } = await this.gnfdClient.bucket.headBucket(bucketName);
    return bucketInfo.id;
  }

  async uploadObject(msg: DelegatedPubObjectRequest) {
    const uploadRes = await this.gnfdClient.object.delegateUploadObject(msg, {
      type: 'ECDSA',
      privateKey: this.walletProvider.getPrivateKey(),
    });
    if (uploadRes.code === 0) {
      elizaLogger.log('upload object success');
    }
    return uploadRes.message;
  }

  async headObject(bucketName: string, objectName: string) {
    const { objectInfo } = await this.gnfdClient.object.headObject(bucketName, objectName);
    return objectInfo.id;
  }

  async deleteObject(msg: MsgDeleteObject) {
    const deleteObjectTx = await this.gnfdClient.object.deleteObject(msg);

    const simulateInfo = await deleteObjectTx.simulate({
      denom: 'BNB',
    });

    const res = await deleteObjectTx.broadcast({
      denom: 'BNB',
      gasLimit: Number(simulateInfo?.gasLimit),
      gasPrice: simulateInfo?.gasPrice || '5000000000',
      payer: msg.operator,
      granter: '',
      privateKey: this.walletProvider.getPrivateKey(),
    });

    if (res.code === 0) {
      elizaLogger.log('delete success');
    }

    return res.transactionHash;
  }
}

export const greenfieldAction = {
  name: 'GREENFIELD_ACTION',
  description: 'create bucket, upload object, delete object on the greenfield chain',
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    _options: any,
    callback?: HandlerCallback
  ) => {
    elizaLogger.log('Starting Gnfd action...');

    // Update state with recent messages
    state = await runtime.composeState(message, ['RECENT_MESSAGES']);

    // Compose prompt
    const prompt = composePromptFromState({
      state,
      template: greenfieldTemplate,
    });
    const result = await runtime.useModel(ModelType.TEXT_LARGE, {
      prompt: prompt,
    });
    const content = parseKeyValueXml(result);

    elizaLogger.log('content', content);

    if (!content) {
      throw new Error('Failed to parse content from model response');
    }

    try {
      const config = await getGnfdConfig(runtime);
      const gnfdClient = await InitGnfdClient(runtime);
      const walletProvider = initWalletProvider(runtime);
      const action = new GreenfieldAction(walletProvider, gnfdClient);

      const actionType = content.actionType;
      const spInfo = await action.selectSp();

      elizaLogger.log('content', content);

      const { bucketName, objectName } = content;
      const attachments = message.content.attachments;
      let result = '';
      switch (actionType) {
        case 'createBucket': {
          const msg = {
            bucketName: bucketName,
            creator: walletProvider.account.address,
            visibility: VisibilityType.VISIBILITY_TYPE_PUBLIC_READ,
            chargedReadQuota: Long.fromString('0'),
            paymentAddress: walletProvider.account.address,
            primarySpAddress: spInfo.primarySpAddress,
          };
          const hash = await action.createBucket(msg);
          const bucketId = await action.headBucket(msg.bucketName);
          result = `create bucket successfully, details: ${config.GREENFIELD_SCAN}/bucket/${toHex(bucketId)}`;
          break;
        }

        case 'uploadObject': {
          if (!attachments) {
            throw new Error('no file to upload');
          }

          const uploadObjName = objectName;

          await action.uploadObject({
            bucketName,
            objectName: uploadObjName,
            body: generateFile(attachments[0]),
            delegatedOpts: {
              visibility: VisibilityType.VISIBILITY_TYPE_PUBLIC_READ,
            },
          });

          const objectId = await action.headObject(bucketName, objectName);

          if (attachments.length > 1) {
            result += `Only one object can be uploaded. \n`;
          }
          result += `Upload object (${uploadObjName}) successfully, details: ${config.GREENFIELD_SCAN}/object/${toHex(objectId)}`;
          break;
        }

        case 'deleteObject': {
          const hash = await action.deleteObject({
            bucketName,
            objectName,
            operator: walletProvider.account.address,
          });
          result = `delete object successfully, hash: 0x${hash}`;
          break;
        }

        case 'crossChainTransfer': {
          const hash = await action.bnbTransferToGnfd(parseEther(String(content.amount)), runtime);
          result = `transfer bnb to greenfield successfully, hash: ${hash}`;
          break;
        }
      }
      if (result) {
        callback?.({
          text: result,
        });
      } else {
        callback?.({
          text: `Unsuccessfully ${actionType || ''}`,
          content: result,
        });
      }

      return true;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      elizaLogger.error('Error execute greenfield action:', errorMessage);
      callback?.({
        text: `Bridge failed: ${errorMessage}`,
        content: { error: errorMessage },
      });
      return false;
    }
  },
  template: greenfieldTemplate,
  validate: async (_runtime: IAgentRuntime) => {
    return true;
  },
  examples: [
    [
      {
        name: 'user',
        content: {
          text: 'Create a bucket(${bucketName}) on greenfield',
          action: 'GREENFIELD_ACTION',
        },
      },
      {
        name: 'user',
        content: {
          text: 'Upload a object(${objectName}) in bucket(${bucketName}) on greenfield',
          action: 'GREENFIELD_ACTION',
        },
      },
      {
        name: 'user',
        content: {
          text: 'Delete object(${objectName}) in bucket(${bucketName}) on greenfield',
          action: 'GREENFIELD_ACTION',
        },
      },
      {
        name: 'user',
        content: {
          text: 'Cross Chain Transfer 0.00001 BNB to myself greenfield for create account',
          action: 'GREENFIELD_ACTION',
          content: {
            amount: '0.00001',
          },
        },
      },
    ],
  ],
  similes: [
    'GREENFIELD_ACTION',
    'CREATE_BUCKET',
    'UPLOAD_OBJECT',
    'DELETE_BUCKET',
    'TRANSFER_BNB_TO_GREENFIELD',
  ],
};

function generateFile(attachment: Media) {
  const filePath = fixPath(attachment.url);

  elizaLogger.log('filePath', filePath);

  const stats = statSync(filePath);
  const fileSize = stats.size;
  const name = extname(filePath);
  const type = lookup(name);

  if (!type) throw new Error(`Unsupported file type: ${filePath}`);

  return {
    name: filePath,
    type,
    size: fileSize,
    content: readFileSync(filePath),
  };
}

function fixPath(url: string) {
  return url.replace('/agent/agent/', '/agent/');
}

function toHex(n: string) {
  return '0x' + Number(n).toString(16).padStart(64, '0');
}
