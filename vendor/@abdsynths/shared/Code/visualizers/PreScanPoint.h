#pragma once

namespace abd::vis
{

struct PreScanPoint
{
    float controlValue{0.0f};  // MIDI value (0..127) or normalized (0.0..1.0)
    float timeSec{0.0f};       // Time position in the pre-scan sweep
    float primaryMetric{0.0f}; // Measured metric (Magnitude dB, Cutoff Hz, or I/O amplitude)
    float thdPercent{0.0f};    // Instantaneous harmonic distortion
};

} // namespace abd::vis
