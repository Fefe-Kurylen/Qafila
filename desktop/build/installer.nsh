; Installateur Qafila : avant de remplacer les fichiers, ferme tout processus Qafila encore ouvert (fenêtre restée
; ouverte, processus d'arrière-plan d'Electron). Sans cela, l'ancien désinstalleur échoue sur des fichiers verrouillés :
; « Échec de désinstallation des anciens fichiers d'application… : 2 ». L'installateur s'appelle Qafila-<version>-win.exe :
; il n'est pas touché par ce filtre sur Qafila.exe.
!macro customInit
  nsExec::Exec 'taskkill /F /T /IM Qafila.exe'
  Pop $0
  Sleep 1000
!macroend
