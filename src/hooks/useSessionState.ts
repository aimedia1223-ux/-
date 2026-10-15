import { useState, useEffect } from 'react';

export function useSessionState<T>(key: string, initialValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  // Retrieve the stored value from sessionStorage (or use initialValue if none)
  const [state, setState] = useState<T>(() => {
    try {
      const item = sessionStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.warn(`Error reading sessionStorage key "${key}":`, error);
      return initialValue;
    }
  });

  // Save the state to sessionStorage whenever it changes
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(state));
    } catch (error) {
      console.warn(`Error setting sessionStorage key "${key}":`, error);
    }
  }, [key, state]);

  return [state, setState];
}
