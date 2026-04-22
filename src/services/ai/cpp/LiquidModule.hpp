#pragma once

#include <NitroModules/HybridObject.hpp>
#include <NitroModules/Promise.hpp>
#include <string>
#include <memory>

namespace margelo::nitro::liquid {

using namespace facebook;

/**
 * A Hybrid Object that provides native GGUF inference using llama.cpp logic.
 */
class LiquidModule: public HybridObject {
public:
  LiquidModule() : HybridObject("LiquidModule") {}

  virtual ~LiquidModule() {}

  /**
   * Load the .gguf model file.
   */
  std::shared_ptr<Promise<void>> loadModel(const std::string& path);

  /**
   * Generate a response for the given prompt.
   */
  std::shared_ptr<Promise<std::string>> generateResponse(const std::string& prompt, const std::optional<double>& maxTokens, const std::optional<double>& temperature);

  /**
   * Check if the model is currently loaded in memory.
   */
  bool isLoaded();

private:
  bool _isLoaded = false;
  std::string _modelPath;
};

} // namespace margelo::nitro::liquid
