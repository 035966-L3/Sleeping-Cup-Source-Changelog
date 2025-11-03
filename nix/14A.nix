with import <nixpkgs> {};
writeShellApplication {
  name = "14A";
  runtimeInputs = [ coreutils ];
  text = builtins.readFile ./14A.sh;
}

