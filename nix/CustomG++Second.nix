with import <nixpkgs> {};
writeShellApplication
{
  name = "CustomG++Second";
  text = builtins.readFile ./CustomG++Second.sh;
}
