module.exports = function(grunt) {

  grunt.initConfig({
    uglify: {
      dist: {
        files: {
          'build/bookshelf-min.js': ['build/bookshelf.js']
        }
      }
    },
    browserify: {
      dist: {
        src: ['bookshelf.js'],
        dest: 'build/bookshelf.js',
        options: {
          external: ['bluebird/js/main/promise', 'lodash', 'knex', 'backbone', 'underscore'],
          ignoreGlobals: true,
          detectGlobals: false,
          standalone: 'bookshelf',
          postBundleCB: function(err, src, next) {
            next(err, src
              .replace('define(e):"undefined"', 'define(["bluebird", "lodash", "knex", "backbone"], e):"undefined"')
              .replace('bluebird/js/main/promise\')()', 'bluebird\')')
              .replace('bluebird/js/main/promise', 'bluebird')
            );
          }
        }
      }
    }
  });

  grunt.loadNpmTasks('grunt-contrib-uglify');
  grunt.loadNpmTasks('grunt-browserify');
  grunt.loadNpmTasks('grunt-release');
  grunt.registerTask('build', ['browserify', 'uglify']);
};