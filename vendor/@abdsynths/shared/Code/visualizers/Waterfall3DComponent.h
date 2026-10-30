#pragma once

#include "PreScanPoint.h"
#include <juce_gui_basics/juce_gui_basics.h>
#include <vector>

namespace abd::vis
{

/**
 * @class Waterfall3DComponent
 * @brief Autonomous, zero-allocation 3D isometric mountain renderer.
 *
 * Visualizes parametric sweeps (filters, saturation, DCW harmonic spread)
 * with interactive camera (mouse drag pan, mouse wheel zoom, double-click reset)
 * and switchable palettes (Retro Emerald vs Thermal Fire).
 */
class Waterfall3DComponent : public juce::Component
{
public:
    Waterfall3DComponent();
    ~Waterfall3DComponent() override = default;

    void paint(juce::Graphics& g) override;

    void mouseDown(const juce::MouseEvent& e) override;
    void mouseDrag(const juce::MouseEvent& e) override;
    void mouseWheelMove(const juce::MouseEvent& e, const juce::MouseWheelDetails& wheel) override;
    void mouseDoubleClick(const juce::MouseEvent& e) override;

    void updateTrajectoryData(const std::vector<PreScanPoint>& newTrajectory);
    void clearData();

    void setPaletteMode(bool useThermal) noexcept;
    bool getPaletteMode() const noexcept { return useThermalPalette; }

    void resetCamera() noexcept;
    void setIsometricOffsets(float xOffset, float yOffset) noexcept;
    void setZoomFactor(float zoom) noexcept;

    float getXOffset() const noexcept { return xOffsetIncrement; }
    float getYOffset() const noexcept { return yOffsetIncrement; }
    float getZoomFactor() const noexcept { return zoom3DFactor; }

private:
    juce::Colour getPaletteColor(float depthRatio) const noexcept;

    std::vector<PreScanPoint> trajectoryCache;
    float xOffsetIncrement{1.5f};
    float yOffsetIncrement{2.0f};
    float zoom3DFactor{1.0f};
    bool useThermalPalette{false};
    juce::Point<int> lastMousePos;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(Waterfall3DComponent)
};

} // namespace abd::vis
