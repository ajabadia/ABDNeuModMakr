export interface AiProviderSettingsPanelOptions {
  container?: HTMLElement | null;
  localClient?: any;
  byokClient?: any;
  onSave?: (cfg: any) => void;
}

export declare class AiProviderSettingsPanel {
  container: HTMLElement | null;
  localClient: any;
  byokClient: any;

  constructor(options?: AiProviderSettingsPanelOptions);
  render(): void;
  setupListeners(): void;
}
