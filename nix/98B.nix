with import <nixpkgs> {};
writeShellApplication {
  name = "98B";
  runtimeInputs = [ coreutils ];
  text = builtins.readFile ./98B.sh;
}

