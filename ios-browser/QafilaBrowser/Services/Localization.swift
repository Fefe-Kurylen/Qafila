import Foundation

/// Texte traduit. La clé est le texte français (langue de développement) ; les traductions sont dans
/// `Resources/<langue>.lproj/Localizable.strings`. Sans traduction, le français s'affiche.
func L(_ key: String) -> String { NSLocalizedString(key, comment: "") }

/// Texte traduit avec valeurs (%@ pour un texte, %ld pour un nombre).
func L(_ key: String, _ args: CVarArg...) -> String {
    String(format: NSLocalizedString(key, comment: ""), locale: Locale.current, arguments: args)
}
