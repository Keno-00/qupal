#include "LiquidModule.hpp"
#include <NitroModules/NitroLogger.hpp>
#include <NitroModules/Dispatcher.hpp>
#include <thread>

namespace margelo::nitro::liquid {

std::shared_ptr<Promise<void>> LiquidModule::loadModel(const std::string& path) {
  auto promise = Promise<void>::create();
  _modelPath = path;

  Logger::log(LogLevel::Info, "LiquidModule", "Loading LFM model from: %s", path.c_str());

  // In a real implementation, we would initialize llama.cpp here.
  // For now, we simulate the loading process on a background thread.
  std::thread([this, promise, path]() {
    try {
      // TODO: Initialize llama_model and llama_context
      std::this_thread::sleep_for(std::chrono::milliseconds(500));
      _isLoaded = true;
      Dispatcher::getMain()->runAsync([promise]() {
        promise->resolve();
      });
    } catch (const std::exception& e) {
      std::string error = e.what();
      Dispatcher::getMain()->runAsync([promise, error]() {
        promise->reject(error);
      });
    }
  }).detach();

  return promise;
}

std::shared_ptr<Promise<std::string>> LiquidModule::generateResponse(const std::string& prompt, const std::optional<double>& maxTokens, const std::optional<double>& temperature) {
  auto promise = Promise<std::string>::create();

  if (!_isLoaded) {
    promise->reject("Model not loaded. Call loadModel() first.");
    return promise;
  }

  Logger::log(LogLevel::Info, "LiquidModule", "Generating response for prompt...");

  std::thread([this, promise, prompt]() {
    // This is where we would call llama_decode and llama_get_logits.
    // We simulate a clinical reasoning delay.
    std::this_thread::sleep_for(std::chrono::seconds(1));

    std::string response = "Native LFM Reasoning: Analysis of the clinical markers indicates a stable pattern. "
                           "The vessel density in the superior quadrant is within the expected 12% range. "
                           "Longitudinal tracking is recommended.";
    
    Dispatcher::getMain()->runAsync([promise, response]() {
      promise->resolve(response);
    });
  }).detach();

  return promise;
}

bool LiquidModule::isLoaded() {
  return _isLoaded;
}

} // namespace margelo::nitro::liquid
