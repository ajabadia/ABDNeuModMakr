#include "Waterfall3DComponent.h"
#include <algorithm>
#include <cmath>

namespace abd::vis
{

Waterfall3DComponent::Waterfall3DComponent()
{
    setOpaque(true);
}

void Waterfall3DComponent::updateTrajectoryData(const std::vector<PreScanPoint>& newTrajectory)
{
    trajectoryCache = newTrajectory;
    repaint();
}

void Waterfall3DComponent::clearData()
{
    trajectoryCache.clear();
    repaint();
}

void Waterfall3DComponent::setPaletteMode(bool useThermal) noexcept
{
    useThermalPalette = useThermal;
    repaint();
}

void Waterfall3DComponent::resetCamera() noexcept
{
    xOffsetIncrement = 1.5f;
    yOffsetIncrement = 2.0f;
    zoom3DFactor     = 1.0f;
    repaint();
}

void Waterfall3DComponent::setIsometricOffsets(float xOffset, float yOffset) noexcept
{
    xOffsetIncrement = juce::jlimit(0.2f, 6.0f, xOffset);
    yOffsetIncrement = juce::jlimit(0.2f, 6.0f, yOffset);
    repaint();
}

void Waterfall3DComponent::setZoomFactor(float zoom) noexcept
{
    zoom3DFactor = juce::jlimit(0.4f, 3.5f, zoom);
    repaint();
}

void Waterfall3DComponent::mouseDown(const juce::MouseEvent& e)
{
    lastMousePos = e.getPosition();
}

void Waterfall3DComponent::mouseDrag(const juce::MouseEvent& e)
{
    auto delta       = e.getPosition() - lastMousePos;
    xOffsetIncrement = juce::jlimit(0.2f, 6.0f, xOffsetIncrement + (static_cast<float>(delta.getX()) * 0.01f));
    yOffsetIncrement = juce::jlimit(0.2f, 6.0f, yOffsetIncrement + (static_cast<float>(delta.getY()) * 0.01f));
    lastMousePos     = e.getPosition();
    repaint();
}

void Waterfall3DComponent::mouseWheelMove(const juce::MouseEvent&, const juce::MouseWheelDetails& wheel)
{
    zoom3DFactor = juce::jlimit(0.4f, 3.5f, zoom3DFactor + (wheel.deltaY * 0.1f));
    repaint();
}

void Waterfall3DComponent::mouseDoubleClick(const juce::MouseEvent&)
{
    resetCamera();
}

juce::Colour Waterfall3DComponent::getPaletteColor(float depthRatio) const noexcept
{
    depthRatio = std::clamp(depthRatio, 0.0f, 1.0f);
    if (useThermalPalette)
    {
        if (depthRatio > 0.7f)
            return juce::Colours::black.interpolatedWith(juce::Colours::darkblue, (depthRatio - 0.7f) / 0.3f);
        if (depthRatio > 0.3f)
            return juce::Colours::darkblue.interpolatedWith(juce::Colours::orangered, (depthRatio - 0.3f) / 0.4f);
        return juce::Colours::orangered.interpolatedWith(juce::Colours::yellow, depthRatio / 0.3f);
    }

    // Default Retro Emerald (Dark night slate blue to vibrant emerald)
    juce::Colour backColor(0xff091a28);
    juce::Colour frontColor(0xff10b981);
    return backColor.interpolatedWith(frontColor, 1.0f - depthRatio);
}

void Waterfall3DComponent::paint(juce::Graphics& g)
{
    // High-contrast deep solid background
    g.fillAll(juce::Colour(0xff0a0c10));

    auto gridBounds = getLocalBounds().toFloat().reduced(16.0f, 12.0f);

    if (trajectoryCache.empty())
    {
        g.setColour(juce::Colour(0xff334155));
        g.setFont(juce::FontOptions(13.0f));
        g.drawText("No 3D Spectral Data Available", getLocalBounds(), juce::Justification::centred);
        return;
    }

    const size_t totalPoints    = trajectoryCache.size();
    const size_t numSlices      = 24;
    const size_t pointsPerSlice = totalPoints / numSlices;

    if (pointsPerSlice < 2)
        return;

    const float baseWidth  = gridBounds.getWidth() * 0.75f * zoom3DFactor;
    const float baseHeight = gridBounds.getHeight() * 0.45f * zoom3DFactor;

    const float startOriginX = gridBounds.getX() + (gridBounds.getWidth() * 0.15f);
    const float startOriginY = gridBounds.getBottom() - (gridBounds.getHeight() * 0.15f);

    juce::Path mountainPath;

    // Render back-to-front for proper visual occlusion
    for (int s = static_cast<int>(numSlices) - 1; s >= 0; --s)
    {
        mountainPath.clear();

        const float depth  = static_cast<float>(s) / static_cast<float>(numSlices - 1);
        const float xShift = (static_cast<float>(s) * xOffsetIncrement * 5.0f * zoom3DFactor);
        const float yShift = -(static_cast<float>(s) * yOffsetIncrement * 4.0f * zoom3DFactor);

        const float sliceOriginX = startOriginX + xShift;
        const float sliceOriginY = startOriginY + yShift;

        const size_t sliceStartIdx = static_cast<size_t>(s) * pointsPerSlice;
        const size_t sliceEndIdx   = std::min(sliceStartIdx + pointsPerSlice, totalPoints);

        if (sliceEndIdx <= sliceStartIdx)
            continue;

        mountainPath.startNewSubPath(sliceOriginX, sliceOriginY);

        for (size_t k = sliceStartIdx; k < sliceEndIdx; ++k)
        {
            float normX = static_cast<float>(k - sliceStartIdx) / static_cast<float>(sliceEndIdx - sliceStartIdx - 1);
            float px    = sliceOriginX + (normX * baseWidth);

            float metricNorm = std::clamp((trajectoryCache[k].primaryMetric + 60.0f) / 70.0f, 0.0f, 1.0f);
            float py         = sliceOriginY - (metricNorm * baseHeight);

            mountainPath.lineTo(px, py);
        }

        mountainPath.lineTo(sliceOriginX + baseWidth, sliceOriginY);
        mountainPath.closeSubPath();

        // 1. Solid underfill (occlusion)
        g.setColour(juce::Colour(0xff0a0c10));
        g.fillPath(mountainPath);

        // 2. Gradient body fill
        juce::Colour sliceColor = getPaletteColor(depth);
        juce::ColourGradient grad(sliceColor.withAlpha(0.65f), sliceOriginX, sliceOriginY - baseHeight,
                                  sliceColor.withAlpha(0.05f), sliceOriginX, sliceOriginY, false);
        g.setGradientFill(grad);
        g.fillPath(mountainPath);

        // 3. Crisp crest line
        g.setColour(sliceColor.withAlpha(0.95f));
        g.strokePath(mountainPath, juce::PathStrokeType(1.2f));
    }
}

} // namespace abd::vis
