import React, {useEffect, useRef, useState} from 'react';
import {usePrivy} from '@privy-io/react-auth';
import {CardSummaryView, SignUpForCardView, useGetCardsForUser, useSignUpForCard} from '@privy-io/react-auth/cards';
import {cardWalletId, findOpenCard} from './card-policy.js';

// Mount beneath the existing PrivyProvider only after the user selects the card
// path at Sell. This component never creates a wallet or submits a coin trade.
export default function PrivyCardAccount({address, config, onClose, onCardReady}) {
  const {user, authenticated} = usePrivy();
  return <CardSession key={`${user?.id || 'none'}:${address}:${config?.environment}`} user={authenticated ? user : null}
    address={address} config={config} onClose={onClose} onCardReady={onCardReady}/>;
}

function CardSession({user, address, config, onClose, onCardReady}) {
  const {getCardsForUser} = useGetCardsForUser();
  const {signUp, close, isOpen} = useSignUpForCard();
  const [cardId, setCardId] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const mounted = useRef(true), locked = useRef(false), closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {mounted.current = true; return () => {mounted.current = false; closeRef.current();};}, []);
  const walletId = cardWalletId(user?.linkedAccounts, address);
  const ready = Boolean(user && walletId && config?.enabled && config?.environment === 'production' && config?.spendApproval);
  async function open() {
    if (!ready || locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      const existing = await findOpenCard(getCardsForUser, config.environment, walletId);
      if (!mounted.current) return;
      const card = existing || await signUp({environment: config.environment, walletId,
        chainId: config.chainId, asset: 'usdc', spendApproval: config.spendApproval});
      if (!mounted.current) return;
      setCardId(card.id); onCardReady?.({id: card.id, userId: user.id, walletId});
    } catch {
      if (mounted.current) setError('Your card could not be opened. Retry to check your existing card before continuing.');
    } finally {locked.current = false; if (mounted.current) setBusy(false);}
  }
  function dismiss() {close(); onClose?.();}
  return <section className="privy-card-account" aria-label="CFK card">
    {error && <p role="alert">{error}</p>}
    {!ready && <p role="status">Card access is not available yet. Your funds have not moved.</p>}
    {!cardId && !isOpen && ready && <><h2>Your CFK card</h2><p>Use your USDC balance for everyday spending. First-time cardholders complete identity verification.</p><button className="primary" disabled={busy} onClick={open}>{busy ? 'Opening your card…' : 'Continue to my card'}</button></>}
    {isOpen && <><button className="secondary" onClick={dismiss}>Cancel card setup</button><SignUpForCardView/></>}
    {cardId && <CardSummaryView key={cardId} cardId={cardId} environment={config.environment} onClose={dismiss} onReplaced={setCardId}/>}
  </section>;
}
