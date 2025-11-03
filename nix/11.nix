with import <nixpkgs> {};
writeShellApplication {
  name = "11";
  runtimeInputs = [ coreutils ];
  text = builtins.readFile ./11.sh;
}

