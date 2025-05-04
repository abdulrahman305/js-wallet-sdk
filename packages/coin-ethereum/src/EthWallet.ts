import {
    assertBufferLength,
    BaseWallet,
    CalcTxHashParams,
    GetAddressParams,
    GetDerivedPathParam,
    GetHardwareRawTransactionError,
    GetHardwareSignedTransactionError,
    GetMpcRawTransactionError,
    GetMpcTransactionError,
    HardwareRawTransactionParam,
    jsonStringifyUniform,
    MpcMessageParam,
    MpcRawTransactionParam,
    MpcTransactionParam,
    NewAddressError,
    NewAddressParams,
    SignTxError,
    SignTxParams,
    TypedMessage,
    ValidAddressParams, ValidPrivateKeyData, ValidPrivateKeyParams,
    validSignedTransactionError,
    ValidSignedTransactionParams,
    VerifyMessageParams
} from '@okxweb3/coin-base';
import {abi, base, BigNumber} from '@okxweb3/crypto-lib';
import * as eth from './index';
import {hexToBytes, unpadBytes, concatBytes, rlp as RLP} from './sdk/ethereumjs-util';
import type {AuthorizationListItem} from './sdk/ethereumjs-tx/types';
import {bytesToHex, unpadBuffer} from "./index";

export type EthEncryptedData = eth.sigUtil.EthEncryptedData

const TOKEN_TRANSFER_FUNCTION_SIGNATURE = '0xa9059cbb';

export type EthTxParams = {
    to: string,
    value: string,
    useValue?: boolean,

    nonce: string,

    contractAddress?: string
    gasPrice: string,
    gasLimit: string,

    data?: string;
    chainId: string;

    // Typed-Transaction features
    // 0: without chainId
    // 1：with chainId；
    // 2：EIP-1559 transaction
    // 4: EIP-7702 set code
    type: number;

    // EIP-2930; Type 1 & EIP-1559; Type 2
    //   accessList?: AccessListish;

    // EIP-1559; Type 2
    maxPriorityFeePerGas: string;
    maxFeePerGas: string;

    // EIP-7702; Type 4
    authorizationList: AuthorizationListItem[];
}

export class EthWallet extends BaseWallet {
    async getDerivedPath(param: GetDerivedPathParam): Promise<any> {
        return `m/44'/60'/0'/0/${param.index}`;
    }

    async getNewAddress(param: NewAddressParams): Promise<any> {
        let pri = param.privateKey;
        let ok = eth.validPrivateKey(pri);
        if(!ok){
            throw new Error('invalid key')
        }
        try {
            const privateKey = base.fromHex(pri.toLowerCase())
            assertBufferLength(privateKey, 32)
            return Promise.resolve(eth.getNewAddress(pri.toLowerCase()));
        } catch (e) {
        }
        return Promise.reject(NewAddressError)
    }

    async validPrivateKey(param: ValidPrivateKeyParams): Promise<any> {
        let isValid = eth.validPrivateKey(param.privateKey);
        const data: ValidPrivateKeyData = {
            isValid: isValid,
            privateKey: param.privateKey
        };
        return Promise.resolve(data);
    }

    async validAddress(param: ValidAddressParams): Promise<any> {
        return Promise.resolve(eth.validAddress(param.address));
    }

    convert2HexString(data: any): string {
        let n: BigNumber
        if (BigNumber.isBigNumber(data)) {
            n = data
        } else {
            // number or string
            n = new BigNumber(data)
        }
        return base.toBigIntHex(n)
    }

    convert2TxParam(data: any): EthTxParams {
        const param = {
            to: data.to,
            // default: value = 0
            value: this.convert2HexString(data.value || 0),
            nonce: this.convert2HexString(data.nonce),
            contractAddress: data.contractAddress,
            gasPrice: this.convert2HexString(data.gasPrice || 0),
            gasLimit: this.convert2HexString(data.gasLimit || 0),
            data: data.data,
            // default chainId: eth mainnet
            chainId: this.convert2HexString(data.chainId || 1),
            type: data.type || 0,
            maxPriorityFeePerGas: this.convert2HexString(data.maxPriorityFeePerGas || 0),
            maxFeePerGas: this.convert2HexString(data.maxFeePerGas || 0),
            authorizationList: data.authorizationList || [],
            useValue: data.useValue || false
        };
        return param as EthTxParams
    }

    async signTransaction(param: SignTxParams): Promise<any> {
        try {
            const privateKey = param.privateKey;
            if (privateKey) {
                assertBufferLength(base.fromHex(privateKey), 32)
            }

            const txParams = this.convert2TxParam(param.data);
            const chainId = txParams.chainId
            const nonce = txParams.nonce
            const type = txParams.type

            if (type === 0 || type === 1) {
                const gasPrice = txParams.gasPrice
                const tokenAddress = txParams.contractAddress;
                let toAddress = txParams.to;
                let value = txParams.value;
                let data: string | undefined;
                if (tokenAddress) {
                    data = TOKEN_TRANSFER_FUNCTION_SIGNATURE + Array.prototype.map
                        .call(abi.RawEncode(['address', 'uint256'], [toAddress, value],),
                            (x: number) => `00${x.toString(16)}`.slice(-2),
                        ).join('');
                    if (!txParams.useValue) {
                        value = '0x0';
                    }
                    toAddress = tokenAddress;
                } else {
                    data = txParams.data;
                }
                const txData = {
                    nonce: nonce,
                    gasPrice: gasPrice,
                    gasLimit: txParams.gasLimit,
                    to: toAddress,
                    value: value,
                    data: data,
                    chainId: chainId,
                    type: type,
                };
                return Promise.resolve(eth.signTransaction(privateKey, txData))
            } else if (type === 2) {
                // EIP-1559 transaction fee
                const tokenAddress = txParams.contractAddress;
                let toAddress = txParams.to;
                let value = txParams.value;
                let data: string | undefined;
                if (tokenAddress) {
                    data = TOKEN_TRANSFER_FUNCTION_SIGNATURE + Array.prototype.map
                        .call(abi.RawEncode(['address', 'uint256'], [toAddress, value],),
                            (x: number) => `00${x.toString(16)}`.slice(-2),
                        ).join('');
                    value = '0x0';
                    toAddress = tokenAddress;
                } else {
                    data = txParams.data;
                }
                const txData = {
                    nonce: nonce,
                    gasLimit: txParams.gasLimit,
                    to: toAddress,
                    value: value,
                    data: data,
                    chainId: chainId,
                    type: type,
                    maxPriorityFeePerGas: txParams.maxPriorityFeePerGas,
                    maxFeePerGas: txParams.maxFeePerGas,
                };
                return Promise.resolve(eth.signTransaction(privateKey, txData))
            } else if (type === 4) {
                // EIP-7702 set code
                const tokenAddress = txParams.contractAddress;
                let toAddress = txParams.to;
                let value = txParams.value;
                let data: string | undefined;
                if (tokenAddress) {
                    data = TOKEN_TRANSFER_FUNCTION_SIGNATURE + Array.prototype.map
                        .call(abi.RawEncode(['address', 'uint256'], [toAddress, value],),
                            (x: number) => `00${x.toString(16)}`.slice(-2),
                        ).join('');
                    value = '0x0';
                    toAddress = tokenAddress;
                } else {
                    data = txParams.data;
                }
                const txData = {
                    nonce: nonce,
                    gasLimit: txParams.gasLimit,
                    to: toAddress,
                    value: value,
                    data: data,
                    chainId: chainId,
                    type: type,
                    maxPriorityFeePerGas: txParams.maxPriorityFeePerGas,
                    maxFeePerGas: txParams.maxFeePerGas,
                    authorizationList: txParams.authorizationList,
                };
                return Promise.resolve(eth.signTransaction(privateKey, txData))
            }
            return Promise.reject(SignTxError)
        } catch (e) {
            return Promise.reject(SignTxError)
        }
    }

    // async signCommonMsg(params: SignCommonMsgParams): Promise<any> {
    //     return super.signCommonMsg({privateKey:params.privateKey, message:params.message, signType:SignType.Secp256k1})
    // }

    async signAuthorizationListItem(param: SignTxParams): Promise<AuthorizationListItem> {
        if (!param.privateKey) {
            throw Error("privateKey is invalid");
        }
        const privateKey = base.fromHex(param.privateKey);
        assertBufferLength(base.fromHex(param.privateKey), 32);

        const { chainId, nonce, address } = param.data;

        const chainIdBytes = eth.unpadBytes(eth.hexToBytes(chainId));
        const nonceBytes =
            nonce !== undefined ? eth.unpadBytes(eth.hexToBytes(nonce)) : new Uint8Array();

        // don't remove pre-zero of address
        const addressBytes = eth.hexToBytes(address);

        const rlpdMsg = RLP.encode([chainIdBytes, addressBytes, nonceBytes]);
        const msgToSign = eth.keccak256(concatBytes(new Uint8Array([5]), rlpdMsg));
        const signed = eth.ecdsaSign(msgToSign, privateKey);

        // all values (except `address`) should be without pre-zero, see: validateNoLeadingZeroes()
        const auth: AuthorizationListItem = {
            chainId: bytesToHex(chainIdBytes),
            address: address,
            nonce: bytesToHex(nonceBytes),
            yParity: (signed.v - 27) === 0 ? '0x' : '0x1',
            r: base.toHex(unpadBuffer(signed.r), true),
            s: base.toHex(unpadBuffer(signed.s), true),
        };

        return auth;
    }

    // as JSON-RPC param, there should not be pre-zero in hex of nonce/yParity/r/s
    async signAuthorizationListItemForRPC(param: SignTxParams): Promise<AuthorizationListItem> {
        const auth = await this.signAuthorizationListItem(param);
        return this.toRpcAuth(auth);
    }

    // remove pre-zero of hex string
    // 0x -> 0x0
    toRpcAuth(auth: AuthorizationListItem): AuthorizationListItem {
        const keys = ['chainId', 'nonce', 'yParity', 'r', 's'];
        const ret: AuthorizationListItem = {...auth};
        for (const key of keys) {
            // @ts-ignore
            ret[key] = this.toRpcHex(ret[key]);
        }
        return ret;
    }

    toRpcHex(hex: string): string {
        const body = hex.slice(2);
        const trimmedBody = body.replace(/^0+/, '') || '0';
        return '0x' + trimmedBody;
    }

    async signMessage(param: SignTxParams): Promise<string> {
        let privateKey;
        if (param.privateKey) {
            assertBufferLength(base.fromHex(param.privateKey), 32)
            privateKey = base.fromHex(param.privateKey)
        }
        const data = param.data as TypedMessage;
        const t = data.type as eth.MessageTypes
        const result = eth.signMessage(t, data.message, privateKey as Buffer);
        return Promise.resolve(result);
    }

    async verifyMessage(param: VerifyMessageParams): Promise<boolean> {
        const d = param.data as TypedMessage;
        const r = await this.ecRecover(d, param.signature)
        const address = param.address || '';
        return Promise.resolve(address.toLowerCase() === r.toLowerCase())
    }

    async ecRecover(message: TypedMessage, signature: string): Promise<string> {
        const t = message.type as eth.MessageTypes
        const publicKey = eth.verifyMessage(t, message.message, base.fromHex(signature))
        const address = base.toHex(eth.publicToAddress(publicKey), true)
        return Promise.resolve(address)
    }

    // publicKey base64 encode
    // data utf8 encode
    // version
    async encrypt(publicKey: string, data: string, version: string): Promise<EthEncryptedData> {
        return Promise.resolve(eth.sigUtil.encrypt({
            publicKey: publicKey,
            data: data,
            version: version,
        }))
    }

    // encryptedData: EthEncryptedData;
    // privateKey hex
    async decrypt(encryptedData: EthEncryptedData, privateKey: string): Promise<string> {
        return Promise.resolve(eth.sigUtil.decrypt({
            encryptedData: encryptedData as any,
            privateKey: base.stripHexPrefix(privateKey),
        }))
    }

    async getEncryptionPublicKey(privateKey: string): Promise<string> {
        return Promise.resolve(eth.sigUtil.getEncryptionPublicKey(base.stripHexPrefix(privateKey)))
    }

    getAddressByPublicKey(param: GetAddressParams): Promise<string> {
        return Promise.resolve(base.toHex(eth.publicToAddress(base.fromHex(param.publicKey), true), true));
    }

    async getMPCRawTransaction(param: MpcRawTransactionParam): Promise<any> {
        try {
            const mpcRaw = await this.signTransaction(param as SignTxParams);
            return Promise.resolve({
                raw: mpcRaw.raw,
                hash: mpcRaw.hash,
            });
        } catch (e) {
            return Promise.reject(GetMpcRawTransactionError);
        }
    }

    async getMPCTransaction(param: MpcTransactionParam): Promise<any> {
        try {
            const signedTx = eth.getMPCTransaction(param.raw, param.sigs as string, param.publicKey!);
            return Promise.resolve(signedTx);
        } catch (e) {
            return Promise.reject(GetMpcTransactionError);
        }
    }

    async getMPCRawMessage(param: MpcRawTransactionParam): Promise<any> {
        try {
            const msgHash = await this.signMessage(param as SignTxParams);
            return Promise.resolve({hash: msgHash});
        } catch (e) {
            return Promise.reject(GetMpcRawTransactionError);
        }
    }

    async getMPCSignedMessage(param: MpcMessageParam): Promise<any> {
        try {
            return Promise.resolve(eth.getMPCSignedMessage(param.hash, param.sigs as string, param.publicKey!));
        } catch (e) {
            return Promise.reject(GetMpcTransactionError);
        }
    }

    async getHardWareRawTransaction(param: SignTxParams): Promise<any> {
        try {
            const rawTx = await this.signTransaction(param as SignTxParams);
            return Promise.resolve(rawTx.serializeRaw);
        } catch (e) {
            return Promise.reject(GetHardwareRawTransactionError);
        }
    }

    // BTC does not need to implement this interface. Hardware wallets can directly generate and broadcast transactions.
    async getHardWareSignedTransaction(param: HardwareRawTransactionParam): Promise<any> {
        try {
            return eth.getSignedTransaction(param.raw, param.r!, param.s!, param.v!);
        } catch (e) {
            return Promise.reject(GetHardwareSignedTransactionError);
        }
    }

    async calcTxHash(param: CalcTxHashParams): Promise<string> {
        const serializedData = base.fromHex(param.data);
        const signedTx = eth.TransactionFactory.fromSerializedData(serializedData);
        return Promise.resolve(base.toHex(signedTx.hash(), true));
    }

    async validSignedTransaction(param: ValidSignedTransactionParams): Promise<any> {
        try {
            const chainId = param.data ? param.data.chainId : undefined
            const publicKey = param.data ? param.data.publicKey : undefined
            const ret = eth.validSignedTransaction(param.tx, chainId, publicKey)
            return Promise.resolve(jsonStringifyUniform(ret));
        } catch (e) {
            return Promise.reject(validSignedTransactionError);
        }
    }
}
