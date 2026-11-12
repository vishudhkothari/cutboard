import { validDate } from "./modelInputs.js";

// Recovery only: a local copy never silently replaces a cloud revision. Each
// account and date has its own key; acknowledge only the exact saved payload.
export function createLogDrafts(storage, userId) {
  if (!userId) throw new Error("Drafts require an account.");
  const prefix=`cutboard:draft:v1:${userId}:`;
  const key=date=>prefix+date;
  return {
    put(log) {
      try {
        if(!validDate(log?.date))return false;
        storage.setItem(key(log.date),JSON.stringify(log));
        return true;
      }catch{return false}
    },
    list() {
      const logs=[];
      try {
        for(let i=0;i<storage.length;i++){
          const name=storage.key(i);
          if(!name?.startsWith(prefix))continue;
          try {
            const log=JSON.parse(storage.getItem(name));
            if(validDate(log?.date)&&name===key(log.date))logs.push(log);
          }catch{/* Retain malformed copies for a manual backup. */}
        }
      }catch{/* Unavailable local storage does not block cloud reads. */}
      return logs.sort((a,b)=>a.date.localeCompare(b.date));
    },
    acknowledge(log) {
      try {
        if(storage.getItem(key(log.date))!==JSON.stringify(log))return false;
        storage.removeItem(key(log.date));
        return true;
      }catch{return false}
    },
    discard(date) {
      try {storage.removeItem(key(date));return true}catch{return false}
    },
  };
}
