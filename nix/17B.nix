with import <nixpkgs> {};
writeShellApplication {
  name = "17B";
  runtimeInputs = [ coreutils ];
  text = builtins.readFile ./17B.sh;
}

