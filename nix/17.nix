with import <nixpkgs> {};
writeShellApplication {
  name = "17";
  runtimeInputs = [ coreutils ];
  text = builtins.readFile ./17.sh;
}

