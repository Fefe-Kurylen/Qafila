; Installateur Qafila : avant de remplacer les fichiers, ferme tout processus Qafila encore ouvert (fenêtre restée
; ouverte, processus d'arrière-plan d'Electron). Sans cela, l'ancien désinstalleur échoue sur des fichiers verrouillés :
; « Échec de désinstallation des anciens fichiers d'application… : 2 ». L'installateur s'appelle Qafila-<version>-win.exe :
; il n'est pas touché par ce filtre sur Qafila.exe.
!macro customInit
  nsExec::Exec 'taskkill /F /T /IM Qafila.exe'
  Pop $0
  Sleep 1000
!macroend

; L'ancien désinstalleur (version déjà installée) peut s'arrêter avec le code 2 alors que plus rien de Qafila ne tourne :
; au lieu de bloquer la mise à jour (« Échec de désinstallation des anciens fichiers d'application »), l'installation
; continue et réécrit les fichiers par-dessus l'ancienne version (les données de l'utilisateur ne sont jamais touchées).
!macro customUnInstallCheck
  ${if} $R0 != 0
    DetailPrint "Ancienne version : désinstalleur arrêté (code $R0), fichiers remplacés par-dessus."
  ${endif}
  ClearErrors
!macroend
!macro customUnInstallCheckCurrentUser
  !insertmacro customUnInstallCheck
!macroend
