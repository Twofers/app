import ExpoModulesCore
import PassKit

public final class TwoferPassKitModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TwoferPassKit")

    AsyncFunction("canAddPassesAsync") {
      PKAddPassesViewController.canAddPasses()
    }

    AsyncFunction("presentPassAsync") { (base64: String) -> String in
      guard PKAddPassesViewController.canAddPasses() else {
        return "unsupported"
      }
      guard
        let data = Data(base64Encoded: base64),
        let pass = try? PKPass(data: data),
        let controller = PKAddPassesViewController(pass: pass)
      else {
        return "invalid_pass"
      }
      guard let presenter = appContext?.utilities?.currentViewController() else {
        return "no_presenter"
      }

      presenter.present(controller, animated: true)
      return "presented"
    }
    .runOnQueue(.main)

    View(TwoferPassKitButtonView.self) {
      Events("onPress")

      Prop("disabled") { (view: TwoferPassKitButtonView, disabled: Bool?) in
        view.setDisabled(disabled ?? false)
      }
    }
  }
}
