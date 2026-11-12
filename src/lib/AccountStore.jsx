import {createContext,useContext,useMemo} from 'react';
import {createAccountStore} from './store';

const AccountStoreContext=createContext(null);
export function AccountStoreProvider({userId,children}) {
  const value=useMemo(()=>createAccountStore(userId),[userId]);
  return <AccountStoreContext.Provider value={value}>{children}</AccountStoreContext.Provider>;
}
export function useAccountStore() {
  const value=useContext(AccountStoreContext);
  if(!value)throw new Error('Account data was requested outside its account workspace.');
  return value;
}
