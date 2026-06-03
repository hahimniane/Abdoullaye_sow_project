import Flutter
import UIKit
import Vision

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  private var vinTextChannel: FlutterMethodChannel?

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    let launched = super.application(application, didFinishLaunchingWithOptions: launchOptions)
    DispatchQueue.main.async { [weak self] in
      self?.configureVinTextRecognitionChannelIfNeeded()
    }
    return launched
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
  }

  override func applicationDidBecomeActive(_ application: UIApplication) {
    super.applicationDidBecomeActive(application)
    configureVinTextRecognitionChannelIfNeeded()
  }

  private func configureVinTextRecognitionChannelIfNeeded() {
    guard vinTextChannel == nil, let controller = rootFlutterViewController() else {
      return
    }
    let channel = FlutterMethodChannel(
      name: "com.autosales.myFlutterApp/vin_text_recognition",
      binaryMessenger: controller.binaryMessenger
    )
    channel.setMethodCallHandler { [weak self] call, result in
      guard call.method == "recognizeText" else {
        result(FlutterMethodNotImplemented)
        return
      }
      guard
        let arguments = call.arguments as? [String: Any],
        let path = arguments["path"] as? String
      else {
        result(FlutterError(code: "bad_arguments", message: "Missing image path", details: nil))
        return
      }
      self?.recognizeText(inImageAt: path, result: result)
    }
    vinTextChannel = channel
  }

  private func rootFlutterViewController() -> FlutterViewController? {
    if let controller = window?.rootViewController as? FlutterViewController {
      return controller
    }
    for scene in UIApplication.shared.connectedScenes {
      guard let windowScene = scene as? UIWindowScene else { continue }
      for window in windowScene.windows {
        if let controller = window.rootViewController as? FlutterViewController {
          return controller
        }
      }
    }
    return nil
  }

  private func recognizeText(inImageAt path: String, result: @escaping FlutterResult) {
    let url = URL(fileURLWithPath: path)
    func finish(_ value: Any?) {
      DispatchQueue.main.async {
        result(value)
      }
    }
    let request = VNRecognizeTextRequest { request, error in
      if let error {
        finish(FlutterError(code: "vision_failed", message: error.localizedDescription, details: nil))
        return
      }
      let lines = (request.results as? [VNRecognizedTextObservation])?
        .compactMap { $0.topCandidates(1).first?.string } ?? []
      finish(lines.joined(separator: "\n"))
    }
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    if #available(iOS 16.0, *) {
      request.revision = VNRecognizeTextRequestRevision3
    }

    DispatchQueue.global(qos: .userInitiated).async {
      do {
        let handler = VNImageRequestHandler(url: url, options: [:])
        try handler.perform([request])
      } catch {
        finish(FlutterError(code: "image_unreadable", message: error.localizedDescription, details: nil))
      }
    }
  }
}
