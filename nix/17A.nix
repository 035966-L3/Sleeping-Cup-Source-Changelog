with import <nixpkgs> {};
writeShellApplication {
  name = "17A";
  runtimeInputs = [ coreutils ];
  text = builtins.readFile ./17A.sh;
}

