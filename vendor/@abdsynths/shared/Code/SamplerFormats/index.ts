// ─────────────────────────────────────────────────────────
// @abdsynths/shared — Universal Sampler Core, Codecs & Format Readers/Writers
//
// Single source of truth for:
//   - UniversalSamplerInstrument & 3-Tier Parameter/Modulation/Region Model
//   - Extended <-> Classic Region Projection & Safe Sound Mapping
//   - Multi-Format Importers & Exporters (SF2, SFZ, Decent Sampler, Kontakt,
//     Akai MPC .xpm/.xpn, Bitwig .multisample, Steinberg HALion .vstpreset,
//     Ableton .adv, Logic EXS24 .exs, TAL-Sampler .talsmpl, CWITEC TX16Wx .txprog,
//     Korg .KMP/.KSF/.KSC, MMA Downloadable Sounds .dls,
//     Linear Sample Chains, REX2 DWOP, Octatrack .ot, RIFF cue/atem/AIFF MARK)
// ─────────────────────────────────────────────────────────

export * from './SamplerTypes.ts';
export * from './SamplerUtils.ts';
export * from './ExtendedAdapter.ts';
export * from './UniversalSamplerModel.ts';
export * from './SliceFileParser.ts';
export * from './DwopDecompressor.ts';
export * from './Sf2Parser.ts';
export * from './SfzParser.ts';
export * from './DecentSamplerParser.ts';
export * from './KontaktParser.ts';
export * from './MpcXpmFormat.ts';
export * from './AbletonAdvFormat.ts';
export * from './Exs24Format.ts';
export * from './TalSamplerFormat.ts';
export * from './Tx16WxFormat.ts';
export * from './KorgKmpKsfFormat.ts';
export * from './DlsFormat.ts';
export * from './Music1010Format.ts';
export * from './DelugeFormat.ts';
export * from './RenoiseFormat.ts';
export * from './BlissFormat.ts';
export * from './PolyendTrackerFormat.ts';
export * from './AkaiDiskFormat.ts';
export * from './EmuDiskFormat.ts';
export * from './RolandDiskFormat.ts';
export * from './EnsoniqDiskFormat.ts';
export * from './YamahaDiskFormat.ts';
export * from './rawSamplerTypes.ts';
export * from './rawSamplerPreflight.ts';
export * from './soundfont2Writer.ts';
export * from './sampleChainWriter.ts';
export * from './RawSamplerExporter.ts';
export {
  type RawSamplerFormat as ParsedRawSamplerFormat,
  type ParsedImportRegion,
  type ParsedSamplerPreset,
  type ArchiveSamplerProgramInfo,
  parseKontaktNki,
  parseHalionVstPreset,
  parseBitwigMultisample,
  mpcProgramToPreset,
  parseAbletonAdvPreset,
  parseExs24Preset,
  parseTalSamplerPreset,
  parseTx16WxPreset,
  parseKorgKmpPreset,
  parseDlsPreset,
  parseSampleChainAudio,
  parseRex2Sampler,
  listZipSamplerPrograms,
  parseUniversalSampler,
} from './rawSamplerParsers.ts';
