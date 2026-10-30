export interface BankCardAction {
  id: string;
  label: string;
  kind?: 'primary' | 'export';
  title?: string;
  iconHtml?: string;
}

export interface BankCardData {
  slot: string | number;
  catClass?: string;
  catLabel?: string;
  name?: string;
  title?: string;
  iconHtml?: string;
  badges?: string[];
  actions?: BankCardAction[];
  selected?: boolean;
  extraClass?: string;
}

export function bankCardHtml(card: BankCardData): string;

export function bindBankCards(
  container: HTMLElement,
  handlers?: {
    onCardClick?: (slot: number) => void;
    onCardDblClick?: (slot: number) => void;
    onAction?: (info: { slot: number; action: string }) => void;
  }
): () => void;
