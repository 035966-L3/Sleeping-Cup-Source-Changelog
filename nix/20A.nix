with import <nixpkgs> {};
writeShellApplication {
  name = "20A";
  runtimeInputs = [ coreutils ];
  text = builtins.readFile ./20A.sh;
}

