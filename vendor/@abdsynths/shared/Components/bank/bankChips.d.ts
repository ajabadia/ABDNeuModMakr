export interface BankChipItem {
  id: string;
  label: string;
  count?: number;
  catClass?: string;
  title?: string;
  prefixHtml?: string;
}

export function bankChipsHtml(items: BankChipItem[], activeId?: string): string;

export function bindBankChips(container: HTMLElement, onPick: (id: string) => void): () => void;
