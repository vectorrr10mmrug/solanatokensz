import { useState } from 'react';
import { Connection, PublicKey, clusterApiUrl, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { WalletProvider, ConnectionProvider, useWallet } from '@solana/wallet-adapter-react';
import {
  PhantomWalletAdapter,
} from '@solana/wallet-adapter-wallets';
import dynamic from 'next/dynamic';
import bs58 from 'bs58';

import { createCreateMetadataAccountV3Instruction, DataV2 } from '@metaplex-foundation/mpl-token-metadata';
import { PROGRAM_ID as METADATA_PROGRAM_ID, findMetadataPda } from '@metaplex-foundation/mpl-token-metadata';

import { config } from '@/config';
import { pinataConfig } from '@/pinata';

require('@solana/wallet-adapter-react-ui/styles.css');

const Home = () => {
  const wallet = useWallet();
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [decimals, setDecimals] = useState(9);
  const [supply, setSupply] = useState(1000000);
  const [logo, setLogo] = useState<File | null>(null);
  const [status, setStatus] = useState('');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setLogo(e.target.files[0]);
    }
  };

  const uploadToIPFS = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pinataConfig.jwt}`
      },
      body: formData,
    });

    if (!res.ok) throw new Error('Erro ao subir imagem para IPFS');

    const json = await res.json();
    return `https://gateway.pinata.cloud/ipfs/${json.IpfsHash}`;
  };

  const uploadMetadataToIPFS = async (meta: object) => {
    const res = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${pinataConfig.jwt}`
      },
      body: JSON.stringify({ pinataContent: meta }),
    });

    if (!res.ok) throw new Error('Erro ao subir metadata JSON para IPFS');

    const json = await res.json();
    return `https://gateway.pinata.cloud/ipfs/${json.IpfsHash}`;
  };

  const createToken = async () => {
    if (!wallet.publicKey || !wallet.signTransaction) {
      alert('Conecte sua carteira!');
      return;
    }

    try {
      setStatus('Subindo imagem para IPFS...');

      const imageUrl = logo ? await uploadToIPFS(logo) : '';

      const metadata = {
        name,
        symbol,
        decimals,
        image: imageUrl,
        description: `Token ${name} criado via Token Creator`,
      };

      setStatus('Subindo metadado JSON para IPFS...');
      const metadataUri = await uploadMetadataToIPFS(metadata);

      setStatus('Criando token...');

      const connection = new Connection(config.rpcUrl || clusterApiUrl('mainnet-beta'), 'confirmed');

      // Envia taxa de criação
      setStatus('Enviando taxa de serviço...');
      const feeTx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: new PublicKey(config.feeReceiver),
          lamports: 0.01 * LAMPORTS_PER_SOL
        })
      );
      const feeSig = await wallet.sendTransaction(feeTx, connection);
      await connection.confirmTransaction(feeSig, 'confirmed');

      const mint = await createMint(
        connection,
        wallet as any,
        wallet.publicKey,
        null,
        decimals
      );

      const tokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        wallet as any,
        mint,
        wallet.publicKey
      );

      await mintTo(
        connection,
        wallet as any,
        mint,
        tokenAccount.address,
        wallet.publicKey,
        supply * 10 ** decimals
      );

      setStatus('Registrando metadados on-chain via Metaplex...');

      const metadataPDA = await findMetadataPda(mint);

      const metadataData: DataV2 = {
        name,
        symbol,
        uri: metadataUri,
        sellerFeeBasisPoints: 0,
        creators: null,
        collection: null,
        uses: null,
      };

      const metadataIx = createCreateMetadataAccountV3Instruction({
        metadata: metadataPDA,
        mint: mint,
        mintAuthority: wallet.publicKey,
        payer: wallet.publicKey,
        updateAuthority: wallet.publicKey,
      }, {
        createMetadataAccountArgsV3: {
          data: metadataData,
          isMutable: true,
          collectionDetails: null,
        },
      });

      const tx = new Transaction().add(metadataIx);
      const sig = await wallet.sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, 'confirmed');

      setStatus(`✅ Token criado com sucesso!
Mint: ${mint.toBase58()}
Metadata IPFS: ${metadataUri}`);
    } catch (err: any) {
      setStatus(`Erro: ${err.message}`);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-6">
      <h1 className="text-3xl font-bold mb-4">Criador de Token Solana</h1>

      <div className="mb-2">
        <WalletMultiButton className="!bg-indigo-600" />
      </div>

      <div className="w-full max-w-md space-y-4">
        <input
          type="text"
          placeholder="Nome do Token"
          className="w-full p-2 rounded bg-gray-800 border border-gray-700"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          type="text"
          placeholder="Símbolo"
          className="w-full p-2 rounded bg-gray-800 border border-gray-700"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
        />
        <input
          type="number"
          placeholder="Decimais (ex: 9)"
          className="w-full p-2 rounded bg-gray-800 border border-gray-700"
          value={decimals}
          onChange={(e) => setDecimals(Number(e.target.value))}
        />
        <input
          type="number"
          placeholder="Supply Inicial"
          className="w-full p-2 rounded bg-gray-800 border border-gray-700"
          value={supply}
          onChange={(e) => setSupply(Number(e.target.value))}
        />
        <input
          type="file"
          className="w-full"
          accept="image/png, image/jpeg"
          onChange={handleFileChange}
        />
        <button
          className="w-full bg-green-600 hover:bg-green-700 p-2 rounded text-white"
          onClick={createToken}
        >
          Criar Token
        </button>

        {status && <p className="mt-2 text-sm text-yellow-400 whitespace-pre-line">{status}</p>}
      </div>
    </div>
  );
};

const App = () => {
  const network = WalletAdapterNetwork.Mainnet;
  const endpoint = config.rpcUrl || clusterApiUrl(network);
  const wallets = [new PhantomWalletAdapter()];

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <Home />
      </WalletProvider>
    </ConnectionProvider>
  );
};

export default dynamic(() => Promise.resolve(App), { ssr: false });
