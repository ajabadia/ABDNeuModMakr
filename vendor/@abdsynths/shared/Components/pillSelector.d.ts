export interface PillItem {
  id: string | number;
  label: string;
  title?: string;
  count?: number;
  iconHtml?: string;
  catClass?: string;
  variant?: string;
  theme?: string;
  disabled?: boolean;
}

export interface PillSelectorOptions {
  id?: string;
  className?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  dense?: boolean;
  nowrap?: boolean;
  attrName?: string;
  items?: Array<PillItem | string>;
  value?: string | number;
  onChange?: (value: string | number, item: PillItem | null, event?: MouseEvent) => void;
}

export declare function escText(s: any): string;
export declare function escAttr(s: any): string;

export declare function pillItemHtml(
  item: PillItem | string,
  activeId?: string | number,
  options?: Partial<PillSelectorOptions>
): string;

export declare function pillSelectorHtml(
  items: Array<PillItem | string>,
  activeId?: string | number,
  options?: Partial<PillSelectorOptions>
): string;

export declare function bindPillSelector(
  container: HTMLElement,
  onSelect: (id: string, btn: HTMLButtonElement, event: MouseEvent) => void,
  attrName?: string
): () => void;

export declare class PillSelector {
  constructor(container: HTMLElement | string, options?: PillSelectorOptions);
  setValue(value: string | number, silent?: boolean, event?: MouseEvent): void;
  getValue(): string | number;
  setItems(items: Array<PillItem | string>): void;
  destroy(): void;
}
