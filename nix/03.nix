with import <nixpkgs> {};
writeShellApplication {
  name = "03";
  runtimeInputs = [ coreutils ];
  text = builtins.readFile ./03.sh;
}

